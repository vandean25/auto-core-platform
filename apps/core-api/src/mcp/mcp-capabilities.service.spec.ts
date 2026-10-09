import { ForbiddenException } from '@nestjs/common';
import { AgentPolicyTier } from '@prisma/client';
import type { AgentPolicyService } from '../agent-policy/agent-policy.service.js';
import type { ResolvedAgentPolicyRule } from '../agent-policy/agent-policy.types.js';
import type { SiteContextService } from '../common/services/site-context.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { DecisionLiveApplyService } from '../decision/decision-live-apply.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { SystemPrismaService } from '../prisma/system-prisma.service.js';
import {
  MCP_NEVER_EXPOSED_ACTIONS,
  MCP_READ_TOOL_NAMES,
} from './mcp.constants.js';
import {
  McpCapabilitiesService,
  type McpCapability,
} from './mcp-capabilities.service.js';
import { decodeMcpCursor } from './mcp-output.util.js';

const TENANT_A = { id: 'tenant-a', name: 'Tenant Alpha' };
const TENANT_B = { id: 'tenant-b', name: 'Tenant Beta' };
const FIREBASE_UID = 'firebase-uid-1';
const SESSION_EMAIL = 'session-user@example.invalid';

type SessionUser = {
  userId: string;
  email: string;
  tenantId?: string;
  role?: string;
  activeSiteId?: string | null;
};

const AGENT_USER: SessionUser = {
  userId: FIREBASE_UID,
  email: SESSION_EMAIL,
  tenantId: TENANT_A.id,
  role: 'ADMIN',
  activeSiteId: 'site-a1',
};

function policyRule(
  actionType: string,
  overrides: Partial<ResolvedAgentPolicyRule> = {},
): ResolvedAgentPolicyRule {
  return {
    id: `rule-${actionType}`,
    version: 1,
    action_type: actionType,
    tier: AgentPolicyTier.AUTO,
    conditions: {},
    enabled: true,
    source: 'platform',
    created_at: new Date('2026-10-01T00:00:00.000Z'),
    updated_at: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  };
}

const TENANT_A_RULES: Record<string, ResolvedAgentPolicyRule | null> = {
  'workshop_order.create': policyRule('workshop_order.create', {
    enabled: false,
  }),
  'inventory.part_reserve': policyRule('inventory.part_reserve'),
  'inventory.part_release': policyRule('inventory.part_release', {
    tier: AgentPolicyTier.HUMAN_ONLY,
  }),
  // A policy row that says AUTO must still be held at PROPOSE by the MCP clamp.
  'workshop_order.propose_line': policyRule('workshop_order.propose_line'),
};

// Visible tools: 15 read tools plus 3 write tools (release_reservation is HUMAN_ONLY).
const VISIBLE_TOOL_COUNT = MCP_READ_TOOL_NAMES.length + 3;

function createService() {
  const authenticated: { user?: SessionUser } = { user: AGENT_USER };
  const tenants: Record<string, { id: string; name: string }> = {
    [TENANT_A.id]: TENANT_A,
    [TENANT_B.id]: TENANT_B,
  };
  const tenantContext = {
    getAuthenticatedUser: jest.fn(() => authenticated.user),
  };
  const siteContext = {
    findSiteId: jest.fn().mockResolvedValue('site-a1'),
  };
  const decisionLiveApply = {
    resolveEffectiveMode: jest.fn().mockResolvedValue('shadow'),
  };
  const prisma = {
    tenant: {
      findUnique: jest.fn(
        async (args: { where: { id: string } }) => tenants[args.where.id] ?? null,
      ),
    },
    site: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'site-a1', name: 'Main site' }),
    },
  };
  const systemPrisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
  const agentPolicy = {
    getEffectiveRule: jest.fn(
      async (actionType: string) => TENANT_A_RULES[actionType] ?? null,
    ),
  };
  const service = new McpCapabilitiesService(
    agentPolicy as unknown as AgentPolicyService,
    decisionLiveApply as unknown as DecisionLiveApplyService,
    prisma as unknown as PrismaService,
    siteContext as unknown as SiteContextService,
    systemPrisma as unknown as SystemPrismaService,
    tenantContext as unknown as TenantContextService,
  );
  return {
    service,
    authenticated,
    agentPolicy,
    decisionLiveApply,
    prisma,
    siteContext,
    systemPrisma,
  };
}

function byTool(data: McpCapability[]): Map<string, McpCapability> {
  return new Map(data.map((entry) => [entry.tool, entry]));
}

describe('McpCapabilitiesService.whoami', () => {
  it('reports the agent as caller with the on-behalf role, tenant, site, and mode', async () => {
    const { service, decisionLiveApply } = createService();
    decisionLiveApply.resolveEffectiveMode.mockResolvedValue('live');

    const result = await service.whoami({ agentId: 'mcp:cursor' });

    expect(result).toEqual({
      caller: { id: 'mcp:cursor', name: 'cursor', type: 'agent' },
      role: 'ADMIN',
      tenant: TENANT_A,
      site: { id: 'site-a1', name: 'Main site' },
      mode: 'live',
    });
    expect(decisionLiveApply.resolveEffectiveMode).toHaveBeenCalledWith(
      TENANT_A.id,
    );
  });

  it('returns no contact details from the session', async () => {
    const { service } = createService();

    const serialized = JSON.stringify(await service.whoami({ agentId: 'mcp:cursor' }));

    expect(serialized).not.toContain(SESSION_EMAIL);
    expect(serialized).not.toContain(FIREBASE_UID);
  });

  it('reports a null site and skips the site lookup when the session has no valid site', async () => {
    const { service, siteContext, prisma } = createService();
    siteContext.findSiteId.mockResolvedValue(null);

    const result = await service.whoami({ agentId: 'mcp:cursor' });

    expect(result.site).toBeNull();
    expect(prisma.site.findFirst).not.toHaveBeenCalled();
  });

  it('reports the human as caller when no agent identity is present', async () => {
    const { service, systemPrisma } = createService();
    systemPrisma.user.findUnique.mockResolvedValue({
      id: 'user-db-1',
      firstName: 'Ada',
      lastName: 'Example',
    });

    const result = await service.whoami({});

    expect(systemPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { firebaseUid: FIREBASE_UID },
      select: { id: true, firstName: true, lastName: true },
    });
    expect(result.caller).toEqual({
      id: 'user-db-1',
      name: 'Ada Example',
      type: 'human_on_behalf',
    });
  });

  it('takes the tenant from the session and never reads another tenant', async () => {
    const { service, prisma } = createService();

    const result = await service.whoami({ agentId: 'mcp:cursor' });

    expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
      where: { id: TENANT_A.id },
      select: { id: true, name: true },
    });
    expect(result.tenant).toEqual(TENANT_A);
    expect(JSON.stringify(result)).not.toContain(TENANT_B.name);
  });

  it('fails closed when the session has no tenant', async () => {
    const { service, authenticated } = createService();
    authenticated.user = { userId: FIREBASE_UID, email: SESSION_EMAIL };

    await expect(service.whoami({ agentId: 'mcp:cursor' })).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('McpCapabilitiesService.getCapabilities', () => {
  it('lists read tools as enabled AUTO and write tools from the configured policy', async () => {
    const { service } = createService();

    const page = await service.getCapabilities({});
    const tools = byTool(page.data);

    expect(page.data.map((entry) => entry.tool)).toEqual([
      ...MCP_READ_TOOL_NAMES,
      'draft_workshop_order',
      'reserve_part',
      'propose_line_item',
    ]);
    expect(page.meta).toEqual({
      total: VISIBLE_TOOL_COUNT,
      page_size: 25,
      next_cursor: null,
    });
    expect(tools.get('reserve_part')).toEqual({
      tool: 'reserve_part',
      description: expect.any(String),
      tier: 'AUTO',
      access: 'write',
      enabled: true,
    });
    expect(tools.get('reserve_part')).not.toHaveProperty('disabled_reason');
    expect(tools.get('propose_line_item')).toMatchObject({
      tier: 'PROPOSE',
      access: 'write',
      enabled: true,
    });
  });

  it('marks a disabled write rule as enabled false with a reason and keeps its configured tier', async () => {
    const { service } = createService();

    const page = await service.getCapabilities({});

    expect(byTool(page.data).get('draft_workshop_order')).toEqual({
      tool: 'draft_workshop_order',
      description: expect.any(String),
      tier: 'AUTO',
      access: 'write',
      enabled: false,
      disabled_reason: 'policy_disabled',
    });
  });

  it('reads each write tool from policy and never hardcodes its tier', async () => {
    const { service, agentPolicy } = createService();

    await service.getCapabilities({});

    expect(agentPolicy.getEffectiveRule).toHaveBeenCalledWith(
      'workshop_order.create',
    );
    expect(agentPolicy.getEffectiveRule).toHaveBeenCalledWith(
      'inventory.part_reserve',
    );
    expect(agentPolicy.getEffectiveRule).toHaveBeenCalledWith(
      'inventory.part_release',
    );
    expect(agentPolicy.getEffectiveRule).toHaveBeenCalledWith(
      'workshop_order.propose_line',
    );
  });

  it('never lists a HUMAN_ONLY write action as a tool and names it in human_only_actions', async () => {
    const { service } = createService();

    const page = await service.getCapabilities({});

    expect(page.data.map((entry) => entry.tool)).not.toContain(
      'release_reservation',
    );
    expect(page.human_only_actions).toEqual(
      [...MCP_NEVER_EXPOSED_ACTIONS, 'inventory.part_release'].sort(),
    );
  });

  it('treats a missing policy rule as fail-closed: not a tool, named as human only', async () => {
    const { service, agentPolicy } = createService();
    agentPolicy.getEffectiveRule.mockImplementation(async (actionType: string) =>
      actionType === 'inventory.part_reserve'
        ? null
        : (TENANT_A_RULES[actionType] ?? null),
    );

    const page = await service.getCapabilities({});

    expect(page.data.map((entry) => entry.tool)).not.toContain('reserve_part');
    expect(page.human_only_actions).toContain('inventory.part_reserve');
  });

  it('pages through the catalog with pageSize and an opaque cursor without gaps or repeats', async () => {
    const { service } = createService();
    const full = await service.getCapabilities({});

    const first = await service.getCapabilities({ pageSize: 5 });
    expect(first.data).toHaveLength(5);
    expect(first.meta).toEqual({
      total: VISIBLE_TOOL_COUNT,
      page_size: 5,
      next_cursor: expect.any(String),
    });
    expect(decodeMcpCursor(first.meta.next_cursor as string)).toBe(5);

    const collected: McpCapability[] = [];
    let cursor: string | undefined;
    do {
      const page = await service.getCapabilities({ pageSize: 5, cursor });
      collected.push(...page.data);
      cursor = page.meta.next_cursor ?? undefined;
    } while (cursor);

    expect(collected).toEqual(full.data);
  });

  it('returns an empty page without a next cursor past the end of the catalog', async () => {
    const { service } = createService();
    const beyondEnd = Buffer.from('1000').toString('base64url');

    const page = await service.getCapabilities({ cursor: beyondEnd });

    expect(page.data).toEqual([]);
    expect(page.meta.next_cursor).toBeNull();
  });

  it('keeps tenant B policy out of tenant A and tenant A policy out of tenant B', async () => {
    const { service, agentPolicy, authenticated } = createService();
    const tenantBRules: Record<string, ResolvedAgentPolicyRule | null> = {
      ...TENANT_A_RULES,
      'workshop_order.create': policyRule('workshop_order.create', {
        enabled: true,
      }),
    };
    agentPolicy.getEffectiveRule.mockImplementation(async (actionType: string) => {
      const rules =
        authenticated.user?.tenantId === TENANT_B.id
          ? tenantBRules
          : TENANT_A_RULES;
      return rules[actionType] ?? null;
    });

    const tenantA = byTool((await service.getCapabilities({})).data);
    expect(tenantA.get('draft_workshop_order')).toMatchObject({
      enabled: false,
      disabled_reason: 'policy_disabled',
    });

    authenticated.user = {
      userId: FIREBASE_UID,
      email: SESSION_EMAIL,
      tenantId: TENANT_B.id,
      role: 'ADMIN',
      activeSiteId: 'site-b1',
    };
    const tenantB = await service.getCapabilities({});
    expect(byTool(tenantB.data).get('draft_workshop_order')).toMatchObject({
      enabled: true,
    });
    expect(byTool(tenantB.data).get('draft_workshop_order')).not.toHaveProperty(
      'disabled_reason',
    );
    expect(JSON.stringify(tenantB)).not.toContain(TENANT_A.name);
  });

  it('keeps every returned entry to the compact contract fields', async () => {
    const { service } = createService();
    const allowedKeys = [
      'tool',
      'description',
      'tier',
      'access',
      'enabled',
      'disabled_reason',
    ];

    const page = await service.getCapabilities({});

    for (const entry of page.data) {
      expect(
        Object.keys(entry).filter((key) => !allowedKeys.includes(key)),
      ).toEqual([]);
    }
  });
});
