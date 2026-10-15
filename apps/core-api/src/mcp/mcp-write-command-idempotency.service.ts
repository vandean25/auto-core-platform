import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  AgentProposalStatus,
  McpWriteCommandReceiptStatus,
  Prisma,
} from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import type { McpWriteToolName } from './mcp.constants.js';
import type {
  McpWriteToolContext,
  McpWriteToolResult,
} from './mcp-write-pipeline.service.js';

export const MCP_COMMAND_IDEMPOTENCY_CONFLICT =
  'MCP_COMMAND_IDEMPOTENCY_CONFLICT';

/** Stale IN_FLIGHT rows may be reclaimed after this age. */
export const MCP_COMMAND_IN_FLIGHT_LEASE_MS = 30_000;

export type McpWriteCommandClaim = {
  receiptId: string;
  originalTraceId: string;
};

type ReceiptRow = {
  id: string;
  tenant_id: string;
  command_id: string;
  on_behalf_of_user_id: string;
  agent_id: string;
  site_id: string | null;
  tool_name: string;
  args_fingerprint: string;
  status: McpWriteCommandReceiptStatus;
  original_trace_id: string;
  response_json: Prisma.JsonValue | null;
  updated_at: Date;
};

@Injectable()
export class McpWriteCommandIdempotencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {}

  /**
   * Claims a command id, reclaims a stale IN_FLIGHT row, or returns a replayable result.
   */
  async beginOrReplay(input: {
    commandId: string;
    toolName: McpWriteToolName;
    argsFingerprint: string;
    context: McpWriteToolContext;
    originalTraceId: string;
  }): Promise<
    | { kind: 'execute'; claim: McpWriteCommandClaim }
    | { kind: 'replay'; result: McpWriteToolResult }
  > {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.resolveSiteId();

    const existing = await this.prisma.mcpWriteCommandReceipt.findFirst({
      where: { tenant_id: tenantId, command_id: input.commandId },
    });

    if (existing) {
      return this.handleExistingReceipt(existing, {
        toolName: input.toolName,
        argsFingerprint: input.argsFingerprint,
        context: input.context,
        siteId,
      });
    }

    try {
      const created = await this.prisma.mcpWriteCommandReceipt.create({
        data: {
          tenant_id: tenantId,
          command_id: input.commandId,
          on_behalf_of_user_id: input.context.onBehalfOfUserId,
          agent_id: input.context.agentId,
          site_id: siteId,
          tool_name: input.toolName,
          args_fingerprint: input.argsFingerprint,
          status: McpWriteCommandReceiptStatus.IN_FLIGHT,
          original_trace_id: input.originalTraceId,
        },
      });
      return {
        kind: 'execute',
        claim: {
          receiptId: created.id,
          originalTraceId: input.originalTraceId,
        },
      };
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
      const raced = await this.prisma.mcpWriteCommandReceipt.findFirst({
        where: { tenant_id: tenantId, command_id: input.commandId },
      });
      if (!raced) {
        throw error;
      }
      return this.handleExistingReceipt(raced, {
        toolName: input.toolName,
        argsFingerprint: input.argsFingerprint,
        context: input.context,
        siteId,
      });
    }
  }

  async completeInTransaction(
    transaction: Prisma.TransactionClient,
    claim: McpWriteCommandClaim,
    result: McpWriteToolResult,
  ): Promise<void> {
    const tenantId = await this.tenantContext.getTenantId();
    const updated = await transaction.mcpWriteCommandReceipt.updateMany({
      where: {
        id: claim.receiptId,
        tenant_id: tenantId,
        status: McpWriteCommandReceiptStatus.IN_FLIGHT,
      },
      data: {
        status: McpWriteCommandReceiptStatus.COMPLETED,
        original_trace_id: result.trace_id ?? claim.originalTraceId,
        response_json: serializeResult(result),
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException(
        'MCP command receipt was not in flight when completing the write',
      );
    }
  }

  async abandon(claim: McpWriteCommandClaim): Promise<void> {
    const tenantId = await this.tenantContext.getTenantId();
    await this.prisma.mcpWriteCommandReceipt.deleteMany({
      where: {
        id: claim.receiptId,
        tenant_id: tenantId,
        status: McpWriteCommandReceiptStatus.IN_FLIGHT,
      },
    });
  }

  private async handleExistingReceipt(
    receipt: ReceiptRow,
    input: {
      toolName: McpWriteToolName;
      argsFingerprint: string;
      context: McpWriteToolContext;
      siteId: string | null;
    },
  ): Promise<
    | { kind: 'execute'; claim: McpWriteCommandClaim }
    | { kind: 'replay'; result: McpWriteToolResult }
  > {
    await this.assertReceiptReplayAllowed(receipt, input);
    this.assertReceiptFingerprint(receipt, input);

    if (receipt.status === McpWriteCommandReceiptStatus.COMPLETED) {
      return {
        kind: 'replay',
        result: this.markReplayed(
          receipt.response_json as unknown as McpWriteToolResult,
          receipt.original_trace_id,
        ),
      };
    }

    const fromProposal = await this.resultFromPendingProposal(receipt);
    if (fromProposal) {
      await this.prisma.mcpWriteCommandReceipt.update({
        where: { id: receipt.id },
        data: {
          status: McpWriteCommandReceiptStatus.COMPLETED,
          response_json: serializeResult(fromProposal),
        },
      });
      return {
        kind: 'replay',
        result: this.markReplayed(fromProposal, receipt.original_trace_id),
      };
    }

    const tenantId = receipt.tenant_id;
    if (await this.tryReclaimStaleInFlight(receipt.id, tenantId)) {
      return {
        kind: 'execute',
        claim: {
          receiptId: receipt.id,
          originalTraceId: receipt.original_trace_id,
        },
      };
    }

    throw new ConflictException({
      code: 'MCP_COMMAND_IN_FLIGHT',
      message:
        'A command with this id is still executing; retry with the same command_id shortly.',
    });
  }

  private async assertReceiptReplayAllowed(
    receipt: ReceiptRow,
    input: {
      context: McpWriteToolContext;
      siteId: string | null;
    },
  ): Promise<void> {
    if (receipt.on_behalf_of_user_id !== input.context.onBehalfOfUserId) {
      throw new ForbiddenException(
        'This command_id belongs to another on-behalf identity.',
      );
    }

    if (receipt.site_id === null) {
      return;
    }

    const authorizedSiteIds = await this.siteContext.listAuthorizedSiteIds();
    if (!authorizedSiteIds.includes(receipt.site_id)) {
      throw new ForbiddenException(
        'You are no longer authorized for the site this command was recorded against.',
      );
    }

    if (input.siteId !== null && input.siteId !== receipt.site_id) {
      throw new ConflictException({
        code: MCP_COMMAND_IDEMPOTENCY_CONFLICT,
        message:
          'The command_id was already used for a different active site context.',
      });
    }
  }

  private assertReceiptFingerprint(
    receipt: ReceiptRow,
    input: {
      toolName: McpWriteToolName;
      argsFingerprint: string;
    },
  ): void {
    if (
      receipt.tool_name !== input.toolName ||
      receipt.args_fingerprint !== input.argsFingerprint
    ) {
      throw new ConflictException({
        code: MCP_COMMAND_IDEMPOTENCY_CONFLICT,
        message:
          'The command_id was already used with a different tool or arguments.',
      });
    }
  }

  private async resultFromPendingProposal(
    receipt: ReceiptRow,
  ): Promise<McpWriteToolResult | null> {
    const proposal = await this.prisma.agentProposal.findFirst({
      where: {
        tenant_id: receipt.tenant_id,
        trace_id: receipt.original_trace_id,
        status: AgentProposalStatus.PENDING,
      },
    });
    if (!proposal) {
      return null;
    }
    const preview = (proposal.preview_json ?? {}) as Record<string, unknown>;
    const wouldChange = (preview.would_change ??
      []) as McpWriteToolResult['would_change'];
    const proposalBody = {
      payload: proposal.payload_json,
      would_change: wouldChange,
      preview: preview.preview ?? preview.result,
      provisional: true as const,
    };
    return {
      tool: receipt.tool_name as McpWriteToolName,
      tier: proposal.tier,
      status: 'needs_approval',
      would_change: wouldChange,
      proposal: proposalBody,
      pending_action_id: proposal.id,
      trace_id: receipt.original_trace_id,
    };
  }

  async tryReclaimStaleInFlight(
    receiptId: string,
    tenantId: string,
  ): Promise<boolean> {
    const cutoff = new Date(Date.now() - MCP_COMMAND_IN_FLIGHT_LEASE_MS);
    const reclaimed = await this.prisma.mcpWriteCommandReceipt.updateMany({
      where: {
        id: receiptId,
        tenant_id: tenantId,
        status: McpWriteCommandReceiptStatus.IN_FLIGHT,
        updated_at: { lt: cutoff },
      },
      data: { updated_at: new Date() },
    });
    return reclaimed.count === 1;
  }

  private markReplayed(
    result: McpWriteToolResult,
    originalTraceId: string,
  ): McpWriteToolResult {
    return {
      ...result,
      trace_id: originalTraceId,
      replayed: true,
    };
  }
}

function serializeResult(result: McpWriteToolResult): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}
