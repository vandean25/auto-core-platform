import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { Site } from '@prisma/client';
import type { AgentProposalService } from '../agent-proposal/agent-proposal.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { SiteContextService } from '../site/site-context.service.js';
import {
  WorkshopCommandSessionService,
  type WorkshopCommandSessionRow,
} from './workshop-command-session.service.js';
import { parseCommandText } from './workshop-command.parse.js';
import type { WorkshopCommandResolver } from './workshop-command.resolve.js';
import { WorkshopCommandService } from './workshop-command.service.js';
import { intentFingerprint } from './workshop-command.tokens.js';
import type {
  InterpretWorkshopCommandDto,
  ProposeWorkshopCommandDto,
} from './dto/workshop-command.dto.js';
import {
  WORKSHOP_COMMAND_CONTRACT_VERSION,
  WORKSHOP_COMMAND_LOCALE,
  type WorkshopIntent,
} from './workshop-command.types.js';

const TENANT_ID = '51500000-0000-4000-8000-000000000001';
const SITE_ID = '51500000-0000-4000-8000-000000000010';
const COMMAND_ID = '51500000-0000-4000-8000-0000000000c1';
const PROPOSAL_ID = '51500000-0000-4000-8000-0000000000d1';
const TRACE_ID = '51500000-0000-4000-8000-0000000000e1';
const SENTENCE = 'Huber Golf morgen 8 Uhr großes Service';
const PREVIEW_AT = new Date('2026-10-15T23:59:00+02:00');
const SUBMIT_AT = new Date('2026-10-16T00:01:00+02:00');

const SITE = {
  id: SITE_ID,
  tenant_id: TENANT_ID,
  timezone: 'Europe/Vienna',
} as unknown as Site;

const REVIEWED: WorkshopIntent = {
  contract_version: WORKSHOP_COMMAND_CONTRACT_VERSION,
  status: 'ready',
  command_id: COMMAND_ID,
  site_id: SITE_ID,
  timezone: 'Europe/Vienna',
  customer_id: '51500000-0000-4000-8000-000000000021',
  vehicle_id: '51500000-0000-4000-8000-000000000031',
  schedule: {
    local_date: '2026-10-16',
    local_start: '08:00',
    local_end: '10:30',
    start_at: '2026-10-16T06:00:00.000Z',
    end_at: '2026-10-16T08:30:00.000Z',
    duration_minutes: 150,
    duration_source: 'preset_sum',
  },
  bay_id: '51500000-0000-4000-8000-000000000041',
  mechanic_id: null,
  loaner: {
    requested: true,
    loaner_vehicle_id: '51500000-0000-4000-8000-000000000051',
    planned_from: '2026-10-16T06:00:00.000Z',
    planned_to: '2026-10-16T08:30:00.000Z',
  },
  position_plan: {
    version: 1,
    lines: [
      {
        preset_key: 'service.major',
        kind: 'LABOR',
        labor_operation_id: '51500000-0000-4000-8000-000000000061',
        catalog_item_id: null,
        description: 'Großes Service',
        quantity: '1.500',
        unit: 'h',
        unit_price_cents: 9000,
        net_cents: 13500,
        reservation: 'not_applicable',
      },
    ],
  },
  purpose: 'CUSTOMER_REPAIR',
  order_status: 'SCHEDULED',
  reported_issue: 'Großes Service',
};

/** The same booking after someone doubled every labor rate. */
function repriced(intent: WorkshopIntent): WorkshopIntent {
  return {
    ...intent,
    position_plan: {
      ...intent.position_plan,
      lines: intent.position_plan.lines.map((line) => ({
        ...line,
        unit_price_cents: line.unit_price_cents * 2,
        net_cents: line.net_cents * 2,
      })),
    },
  };
}

/** The same booking one day later, because 'morgen' crossed midnight. */
function oneDayLater(intent: WorkshopIntent): WorkshopIntent {
  return {
    ...intent,
    schedule: { ...intent.schedule, local_date: '2026-10-17' },
  };
}

function sessionKey(tenantId: string, commandId: string): string {
  return `${tenantId}\u0000${commandId}`;
}

function createHarness(userOverride?: { role?: string } | null) {
  const sessions = new Map<string, WorkshopCommandSessionRow>();
  const proposals = new Map<string, Record<string, unknown>>();

  const resolver = {
    parse: async (_tenantId: string, text: string, now: Date) =>
      parseCommandText(
        text,
        { sites: [{ code: 'WIE', name: 'Pilot Wien' }] },
        now,
        'Europe/Vienna',
      ),
    resolveParsed: jest.fn(),
  };
  const store = {
    purgeExpired: jest.fn(async () => undefined),
    find: jest.fn(
      async (tenantId: string, commandId: string) =>
        sessions.get(sessionKey(tenantId, commandId)) ?? null,
    ),
    save: jest.fn(
      async (input: Parameters<WorkshopCommandSessionService['save']>[0]) => {
        sessions.set(sessionKey(input.tenantId, input.commandId), {
          id: 'session-1',
          tenant_id: input.tenantId,
          command_id: input.commandId,
          site_id: input.siteId,
          source: input.source,
          expires_at: new Date(input.now.getTime() + 7 * 24 * 60 * 60 * 1000),
          replay: input.replay,
        });
      },
    ),
    freezeForProposal: jest.fn(
      async (
        input: Parameters<WorkshopCommandSessionService['freezeForProposal']>[0],
      ) => {
        const row = sessions.get(sessionKey(input.tenantId, input.commandId));
        if (!row) return;
        sessions.set(sessionKey(input.tenantId, input.commandId), {
          ...row,
          replay: input.replay,
        });
      },
    ),
  };
  const submissions = {
    submitPendingAction: jest.fn(
      async (
        data: Parameters<AgentProposalService['submitPendingAction']>[0],
        options?: Parameters<AgentProposalService['submitPendingAction']>[1],
      ) => {
        proposals.set(String(data.command_id), {
          id: PROPOSAL_ID,
          trace_id: TRACE_ID,
          status: 'PENDING',
          tenant_id: TENANT_ID,
          command_id: data.command_id,
          preview_json: options?.preview_json,
        });
        return { id: PROPOSAL_ID, trace_id: TRACE_ID, expires_at: null };
      },
    ),
  };
  const prisma = {
    agentProposal: {
      findFirst: jest.fn(
        async ({ where }: { where: { command_id: string } }) =>
          proposals.get(where.command_id) ?? null,
      ),
    },
  };
  const tenantContext = {
    getTenantId: async () => TENANT_ID,
    getAuthenticatedUser: () => (userOverride !== undefined ? userOverride : { role: 'ADMIN' }),
  };
  const siteContext = { getSite: async () => SITE };

  const service = new WorkshopCommandService(
    prisma as unknown as PrismaService,
    tenantContext as unknown as TenantContextService,
    siteContext as unknown as SiteContextService,
    resolver as unknown as WorkshopCommandResolver,
    store as unknown as WorkshopCommandSessionService,
    submissions as unknown as AgentProposalService,
  );

  return { service, resolver, store, submissions, sessions };
}

function interpretDto(): InterpretWorkshopCommandDto {
  return {
    contract_version: WORKSHOP_COMMAND_CONTRACT_VERSION,
    command_id: COMMAND_ID,
    source: 'keyboard',
    locale: WORKSHOP_COMMAND_LOCALE,
    text: SENTENCE,
  };
}

function proposeDto(): ProposeWorkshopCommandDto {
  return {
    contract_version: WORKSHOP_COMMAND_CONTRACT_VERSION,
    command_id: COMMAND_ID,
  };
}

async function conflictOf(promise: Promise<unknown>): Promise<ConflictException> {
  return promise.then(
    () => {
      throw new Error('Expected the command to be refused.');
    },
    (error: ConflictException) => error,
  );
}

async function reviewPreview(
  h: ReturnType<typeof createHarness>,
  reviewed = REVIEWED,
): Promise<void> {
  h.resolver.resolveParsed.mockResolvedValueOnce(reviewed);
  const result = await h.service.interpret(interpretDto(), PREVIEW_AT);
  expect(result.status).toBe('ready');
}

function expectPlanStale(error: ConflictException): void {
  expect(error).toBeInstanceOf(ConflictException);
  expect(error.getResponse()).toEqual(
    expect.objectContaining({
      code: 'PLAN_STALE',
      message: expect.stringContaining('plan changed after the preview'),
    }),
  );
}

describe('WorkshopCommandService reviewed plan', () => {
  it('stores the fingerprint of the intent the advisor reviewed', async () => {
    const h = createHarness();
    await reviewPreview(h);

    const replay = h.sessions.get(sessionKey(TENANT_ID, COMMAND_ID))?.replay;
    expect(replay?.reviewed_fingerprint).toBe(intentFingerprint(REVIEWED));
  });

  it('submits the reviewed plan when live data still resolves it', async () => {
    const h = createHarness();
    await reviewPreview(h);
    h.resolver.resolveParsed.mockResolvedValueOnce(REVIEWED);

    const outcome = await h.service.propose(proposeDto(), SUBMIT_AT);

    expect(outcome.statusCode).toBe(201);
    expect(h.submissions.submitPendingAction).toHaveBeenCalledTimes(1);
  });

  it('refuses to submit a plan that a live labor rate made more expensive', async () => {
    const h = createHarness();
    await reviewPreview(h);
    h.resolver.resolveParsed.mockResolvedValueOnce(repriced(REVIEWED));

    const error = await conflictOf(h.service.propose(proposeDto(), SUBMIT_AT));

    expectPlanStale(error);
    expect(h.submissions.submitPendingAction).not.toHaveBeenCalled();
  });

  it('refuses to submit the day the advisor did not review after midnight', async () => {
    const h = createHarness();
    await reviewPreview(h);
    h.resolver.resolveParsed.mockResolvedValueOnce(oneDayLater(REVIEWED));

    const error = await conflictOf(h.service.propose(proposeDto(), SUBMIT_AT));

    expectPlanStale(error);
    expect(h.submissions.submitPendingAction).not.toHaveBeenCalled();
  });

  it('refuses to restate a pending proposal whose plan drifted', async () => {
    const h = createHarness();
    await reviewPreview(h);
    h.resolver.resolveParsed.mockResolvedValueOnce(REVIEWED);
    await h.service.propose(proposeDto(), SUBMIT_AT);
    h.resolver.resolveParsed.mockResolvedValueOnce(repriced(REVIEWED));

    const error = await conflictOf(h.service.propose(proposeDto(), SUBMIT_AT));

    expectPlanStale(error);
    expect(h.submissions.submitPendingAction).toHaveBeenCalledTimes(1);
  });

  it('repeats the pending proposal while the reviewed plan still holds', async () => {
    const h = createHarness();
    await reviewPreview(h);
    h.resolver.resolveParsed.mockResolvedValueOnce(REVIEWED);
    const first = await h.service.propose(proposeDto(), SUBMIT_AT);
    h.resolver.resolveParsed.mockResolvedValueOnce(REVIEWED);

    const retry = await h.service.propose(proposeDto(), SUBMIT_AT);

    expect(retry.statusCode).toBe(200);
    expect(retry.body.pending_action_id).toBe(first.body.pending_action_id);
  });
});

describe('WorkshopCommandService role matrix authorization', () => {
  describe('interpret role matrix', () => {
    it.each([
      ['OWNER', true],
      ['ADMIN', true],
      ['SALES', true],
      ['TECH', false],
      ['MECHANIC', false],
      ['SERVICE_ADVISOR', false],
      ['ACCOUNTANT', false],
      ['SUPER_ADMIN', false],
      ['DEMO', false],
      ['', false],
      [null, false],
      [undefined, false],
    ] as const)('evaluates role %s (allowed: %s)', async (role, allowed) => {
      const user = role === null ? null : role === undefined ? {} : { role };
      const h = createHarness(user);
      h.resolver.resolveParsed.mockResolvedValueOnce(REVIEWED);
      if (allowed) {
        const result = await h.service.interpret(interpretDto(), PREVIEW_AT);
        expect(result.status).toBe('ready');
      } else {
        await expect(h.service.interpret(interpretDto(), PREVIEW_AT)).rejects.toThrow(
          ForbiddenException,
        );
      }
    });
  });

  describe('propose role matrix', () => {
    it.each([
      ['OWNER', true],
      ['ADMIN', true],
      ['SALES', false],
      ['TECH', false],
      ['MECHANIC', false],
      ['SERVICE_ADVISOR', false],
      ['ACCOUNTANT', false],
      ['SUPER_ADMIN', false],
      ['DEMO', false],
      ['', false],
      [null, false],
      [undefined, false],
    ] as const)('evaluates role %s (allowed: %s)', async (role, allowed) => {
      const adminH = createHarness({ role: 'ADMIN' });
      await reviewPreview(adminH);
      const session = adminH.sessions.get(sessionKey(TENANT_ID, COMMAND_ID));

      const user = role === null ? null : role === undefined ? {} : { role };
      const h = createHarness(user);
      if (session) {
        h.sessions.set(sessionKey(TENANT_ID, COMMAND_ID), session);
      }
      h.resolver.resolveParsed.mockResolvedValueOnce(REVIEWED);

      if (allowed) {
        const outcome = await h.service.propose(proposeDto(), SUBMIT_AT);
        expect(outcome.statusCode).toBe(201);
      } else {
        await expect(h.service.propose(proposeDto(), SUBMIT_AT)).rejects.toThrow(
          ForbiddenException,
        );
      }
    });
  });
});
