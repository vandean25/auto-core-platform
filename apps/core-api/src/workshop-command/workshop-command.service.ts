import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AgentProposalStatus, Prisma } from '@prisma/client';
import type { Site } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { AgentProposalService } from '../agent-proposal/agent-proposal.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WorkshopCommandResolver } from './workshop-command.resolve.js';
import { WorkshopCommandSessionService } from './workshop-command-session.service.js';
import { buildProposalResult } from './workshop-command.proposal.js';
import {
  commandFingerprint,
  isSelectionOffered,
  sameTokens,
  offeredChoicesOf,
  parsedFromReplay,
  replayFromParsed,
  sameSelections,
  selectTokens,
  tokensOfParsed,
  type WorkshopCommandReplay,
} from './workshop-command.tokens.js';
import {
  WORKSHOP_COMMAND_ACTION_TYPE,
  WORKSHOP_COMMAND_CONTRACT_VERSION,
  WORKSHOP_COMMAND_LOCALE,
  WORKSHOP_COMMAND_MAX_TEXT_LENGTH,
  type Clarification,
  type CommandSelection,
  type InterpretResult,
  type ProposalResult,
  type WorkshopIntent,
} from './workshop-command.types.js';
import type {
  InterpretWorkshopCommandDto,
  ProposeWorkshopCommandDto,
} from './dto/workshop-command.dto.js';

const INTERPRET_ROLES = new Set(['OWNER', 'ADMIN', 'SALES']);
const PROPOSE_ROLES = new Set(['OWNER', 'ADMIN']);

const PLAN_STALE = 'PLAN_STALE';
const AMBIGUITY_CODES = new Set([
  'CUSTOMER_AMBIGUOUS',
  'VEHICLE_AMBIGUOUS',
  'RESOURCE_AMBIGUOUS',
  'TIME_AMBIGUOUS',
]);

export type ProposeOutcome = {
  statusCode: 200 | 201;
  body: ProposalResult;
};

function conflict(code: string, message: string): ConflictException {
  return new ConflictException({ code, message });
}

function dedupeSelections(
  selections: Array<{ slot: string; value: string }> | undefined,
): CommandSelection[] {
  if (!selections?.length) return [];
  const seen = new Set<string>();
  const result: CommandSelection[] = [];
  for (const selection of selections) {
    const key = `${selection.slot}\u0000${selection.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ slot: selection.slot, value: selection.value });
  }
  return result;
}

@Injectable()
export class WorkshopCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly resolver: WorkshopCommandResolver,
    private readonly sessions: WorkshopCommandSessionService,
    private readonly agentProposals: AgentProposalService,
  ) {}

  async interpret(
    dto: InterpretWorkshopCommandDto,
    now: Date = new Date(),
  ): Promise<InterpretResult> {
    this.assertRole(INTERPRET_ROLES);
    this.assertContract(dto.contract_version);
    if (dto.locale !== WORKSHOP_COMMAND_LOCALE) {
      throw new BadRequestException({
        code: 'LOCALE_UNSUPPORTED',
        message: `locale must be ${WORKSHOP_COMMAND_LOCALE}`,
      });
    }
    const text = dto.text.trim();
    if (text.length === 0 || text.length > WORKSHOP_COMMAND_MAX_TEXT_LENGTH) {
      throw new BadRequestException({
        code: 'TEXT_TOO_LONG',
        message: `text must be 1-${WORKSHOP_COMMAND_MAX_TEXT_LENGTH} characters`,
      });
    }

    const tenantId = await this.tenantContext.getTenantId();
    const site = await this.siteContext.getSite();
    await this.sessions.purgeExpired(tenantId, now);

    const selections = dedupeSelections(dto.selections);
    const parsed = await this.resolver.parse(
      tenantId,
      text,
      now,
      site.timezone,
    );
    const tokens = tokensOfParsed(parsed);
    const proposal = await this.findProposal(tenantId, dto.command_id);
    const session = await this.sessions.find(tenantId, dto.command_id);

    if (proposal) {
      if (proposal.status !== AgentProposalStatus.PENDING) {
        throw conflict(
          'COMMAND_ID_REUSED',
          'This command already has a decided proposal.',
        );
      }
      const fingerprint = commandFingerprint(tokens, selections);
      if (
        !session ||
        fingerprint !== this.storedFingerprint(proposal.preview_json) ||
        !sameSelections(selections, session.replay.selections)
      ) {
        throw conflict(
          'COMMAND_ID_REUSED',
          'Tokens or selections differ from the stored command.',
        );
      }
      return this.resolveReplay(session.replay, site, dto.command_id, now);
    }

    if (session) {
      if (!sameTokens(selectTokens(session.replay), tokens)) {
        throw conflict(
          'COMMAND_ID_REUSED',
          'Tokens differ from the stored command.',
        );
      }
      this.assertSelectionsWereOffered(selections, session.replay);
    } else if (selections.length > 0) {
      throw conflict(
        'SELECTION_NOT_OFFERED',
        'Selections require an earlier interpret that offered them.',
      );
    }

    const result = await this.resolver.resolveParsed(parsed, {
      tenantId,
      site,
      text,
      commandId: dto.command_id,
      source: dto.source,
      now,
      selections,
    });
    await this.sessions.save({
      tenantId,
      commandId: dto.command_id,
      siteId: site.id,
      source: dto.source,
      now,
      replay: replayFromParsed(parsed, {
        selections,
        offeredChoices: offeredChoicesOf(
          result.status === 'clarification' ? result.choices : [],
        ),
        status: result.status,
      }),
    });
    return result;
  }

  async propose(
    dto: ProposeWorkshopCommandDto,
    now: Date = new Date(),
  ): Promise<ProposeOutcome> {
    this.assertRole(PROPOSE_ROLES);
    this.assertContract(dto.contract_version);

    const tenantId = await this.tenantContext.getTenantId();
    const site = await this.siteContext.getSite();
    await this.sessions.purgeExpired(tenantId, now);

    const selections = dedupeSelections(dto.selections);
    const proposal = await this.findProposal(tenantId, dto.command_id);
    if (proposal) {
      return this.retryProposal(
        tenantId,
        dto.command_id,
        proposal,
        selections,
        site,
        now,
      );
    }

    const session = await this.sessions.find(tenantId, dto.command_id);
    if (!session) {
      throw new NotFoundException({
        code: 'SESSION_NOT_FOUND',
        message: 'No interpreted command exists for this command_id.',
      });
    }
    this.assertSelectionsWereOffered(selections, session.replay);
    if (session.site_id !== site.id) {
      throw conflict(
        PLAN_STALE,
        'The operative site changed after the preview; interpret again.',
      );
    }

    const result = await this.resolveReplay(
      session.replay,
      site,
      dto.command_id,
      now,
      selections,
    );
    if (result.status === 'clarification') {
      const code = this.isPlanStale(result, selections)
        ? PLAN_STALE
        : 'INTENT_INCOMPLETE';
      throw conflict(code, result.prompt);
    }

    const fingerprint = commandFingerprint(
      selectTokens(session.replay),
      selections,
    );
    let created: Awaited<
      ReturnType<AgentProposalService['submitPendingAction']>
    >;
    try {
      created = await this.agentProposals.submitPendingAction(
        {
          action_type: WORKSHOP_COMMAND_ACTION_TYPE,
          payload_json: result,
          command_id: dto.command_id,
        },
        {
          command_id: dto.command_id,
          preview_json: { command_fingerprint: fingerprint },
        },
      );
    } catch (error) {
      const duplicate = await this.recoverDuplicateProposal(
        tenantId,
        dto.command_id,
        fingerprint,
        selections,
      );
      if (duplicate) return duplicate;
      throw error;
    }

    const frozenReplay: WorkshopCommandReplay = {
      ...session.replay,
      selections,
      last_status: 'ready',
    };
    await this.sessions.freezeForProposal({
      tenantId,
      commandId: dto.command_id,
      replay: frozenReplay,
      status: 'ready',
      proposalExpiresAt: created.expires_at
        ? new Date(created.expires_at)
        : null,
    });

    return {
      statusCode: 201,
      body: buildProposalResult(result, created.id, created.trace_id),
    };
  }

  private async retryProposal(
    tenantId: string,
    commandId: string,
    proposal: {
      id: string;
      trace_id: string;
      status: AgentProposalStatus;
      preview_json: Prisma.JsonValue | null;
    },
    selections: CommandSelection[],
    site: Site,
    now: Date,
  ): Promise<ProposeOutcome> {
    if (proposal.status !== AgentProposalStatus.PENDING) {
      throw conflict(
        'COMMAND_ID_REUSED',
        'This command already has a decided proposal.',
      );
    }
    const session = await this.sessions.find(tenantId, commandId);
    if (!session) {
      throw conflict(
        'COMMAND_ID_REUSED',
        'The replay row for this command is gone.',
      );
    }
    const fingerprint = commandFingerprint(
      selectTokens(session.replay),
      selections,
    );
    if (
      fingerprint !== this.storedFingerprint(proposal.preview_json) ||
      !sameSelections(selections, session.replay.selections)
    ) {
      throw conflict(
        'COMMAND_ID_REUSED',
        'Tokens or selections differ from the stored command.',
      );
    }
    const intent = await this.recomputeIntent(
      session.replay,
      site,
      now,
      selections,
    );
    if (!intent) {
      throw conflict(
        'COMMAND_ID_REUSED',
        'The stored command no longer resolves.',
      );
    }
    return {
      statusCode: 200,
      body: buildProposalResult(intent, proposal.id, proposal.trace_id),
    };
  }

  private async resolveReplay(
    replay: WorkshopCommandReplay,
    site: Site,
    commandId: string,
    now: Date,
    selections: CommandSelection[] = replay.selections,
  ): Promise<InterpretResult> {
    const tenantId = await this.tenantContext.getTenantId();
    return this.resolver.resolveParsed(parsedFromReplay(replay), {
      tenantId,
      site,
      text: '',
      commandId,
      source: 'keyboard',
      now,
      selections,
    });
  }

  private async recomputeIntent(
    replay: WorkshopCommandReplay,
    site: Site,
    now: Date,
    selections: CommandSelection[],
  ): Promise<WorkshopIntent | null> {
    const result = await this.resolveReplay(replay, site, '', now, selections);
    return result.status === 'ready' ? result : null;
  }

  private isPlanStale(
    result: Clarification,
    selections: CommandSelection[],
  ): boolean {
    return selections.length > 0 && AMBIGUITY_CODES.has(result.code);
  }

  private assertSelectionsWereOffered(
    selections: CommandSelection[],
    replay: WorkshopCommandReplay,
  ): void {
    const accepted = [...replay.offered_choices, ...replay.selections];
    const unknown = selections.find(
      (selection) => !isSelectionOffered(selection, accepted),
    );
    if (unknown) {
      throw conflict(
        'SELECTION_NOT_OFFERED',
        `Selection ${unknown.slot}=${unknown.value} was not offered.`,
      );
    }
  }

  private storedFingerprint(preview: Prisma.JsonValue | null): string | null {
    if (!preview || typeof preview !== 'object' || Array.isArray(preview)) {
      return null;
    }
    const value = (preview as Record<string, unknown>).command_fingerprint;
    return typeof value === 'string' ? value : null;
  }

  private async findProposal(tenantId: string, commandId: string) {
    return this.prisma.agentProposal.findFirst({
      where: { tenant_id: tenantId, command_id: commandId },
      select: {
        id: true,
        trace_id: true,
        status: true,
        preview_json: true,
        expires_at: true,
      },
    });
  }

  /** Handles a concurrent first propose that lost the unique-constraint race. */
  private async recoverDuplicateProposal(
    tenantId: string,
    commandId: string,
    fingerprint: string,
    selections: CommandSelection[],
  ): Promise<ProposeOutcome | null> {
    const existing = await this.findProposal(tenantId, commandId);
    if (!existing) return null;
    if (
      existing.status !== AgentProposalStatus.PENDING ||
      this.storedFingerprint(existing.preview_json) !== fingerprint
    ) {
      return null;
    }
    const session = await this.sessions.find(tenantId, commandId);
    if (!session || !sameSelections(selections, session.replay.selections)) {
      return null;
    }
    const site = await this.siteContext.getSite();
    const intent = await this.recomputeIntent(
      session.replay,
      site,
      new Date(),
      selections,
    );
    if (!intent) return null;
    return {
      statusCode: 200,
      body: buildProposalResult(intent, existing.id, existing.trace_id),
    };
  }

  private assertRole(allowed: Set<string>): void {
    const user = this.tenantContext.getAuthenticatedUser();
    if (!user) {
      throw new ForbiddenException('Active tenant membership is required.');
    }
    const role = 'role' in user ? user.role : undefined;
    if (!role || !allowed.has(role)) {
      throw new ForbiddenException(
        'This command is not available for your role.',
      );
    }
  }

  private assertContract(version: string): void {
    if (version !== WORKSHOP_COMMAND_CONTRACT_VERSION) {
      throw new BadRequestException({
        code: 'CONTRACT_VERSION_UNSUPPORTED',
        message: `contract_version must be ${WORKSHOP_COMMAND_CONTRACT_VERSION}`,
      });
    }
  }
}
