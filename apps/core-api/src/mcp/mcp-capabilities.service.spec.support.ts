import { AgentPolicyTier } from '@prisma/client';
import type { AgentPolicyService } from '../agent-policy/agent-policy.service.js';
import type { ResolvedAgentPolicyRule } from '../agent-policy/agent-policy.types.js';
import type { SiteContextService } from '../common/services/site-context.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { DecisionLiveApplyService } from '../decision/decision-live-apply.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { SystemPrismaService } from '../prisma/system-prisma.service.js';
import type { McpUserLocaleService } from './mcp-user-locale.service.js';
import {
  McpCapabilitiesService,
  type McpCapability,
} from './mcp-capabilities.service.js';
import { getCapabilitiesWithWave2Reads } from './mcp-read-wave2-capabilities-read.js';

/** A platform policy rule for the capability tests. */
export function policyRule(
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

/** The policy rules the capability tests read. */
export const TENANT_A_RULES: Record<string, ResolvedAgentPolicyRule | null> = {
  'workshop_order.create': policyRule('workshop_order.create', {
    enabled: false,
  }),
  'inventory.part_reserve': policyRule('inventory.part_reserve'),
  'inventory.part_release': policyRule('inventory.part_release', {
    tier: AgentPolicyTier.HUMAN_ONLY,
  }),
  // A policy row that says AUTO must still be held at PROPOSE by the MCP clamp.
  'workshop_order.propose_line': policyRule('workshop_order.propose_line'),
  'registration_intake.apply': policyRule('registration_intake.apply', {
    enabled: false,
  }),
  'workshop.booking_package': policyRule('workshop.booking_package', {
    enabled: false,
  }),
  'purchase_order.propose_draft': policyRule('purchase_order.propose_draft', {
    enabled: false,
  }),
  'workshop_order.complete': policyRule('workshop_order.complete', {
    enabled: false,
  }),
  'invoice.create_draft_from_workshop_order': policyRule(
    'invoice.create_draft_from_workshop_order',
    { enabled: false },
  ),
  'estimate.send_customer_message': policyRule('estimate.send_customer_message', {
    enabled: false,
  }),
  'workshop.media_upload_slot': policyRule('workshop.media_upload_slot', {
    enabled: false,
  }),
  'workshop_order.propose_mechanic_finding': policyRule(
    'workshop_order.propose_mechanic_finding',
    { enabled: false },
  ),
  'customer.create': policyRule('customer.create', {
    tier: AgentPolicyTier.PROPOSE,
    enabled: false,
  }),
  'customer.update': policyRule('customer.update', {
    tier: AgentPolicyTier.PROPOSE,
    enabled: false,
  }),
  'report.generate_weekly_pdf': policyRule('report.generate_weekly_pdf', {
    enabled: false,
  }),
};

export const TENANT_A = { id: 'tenant-a', name: 'Tenant Alpha' };
export const TENANT_B = { id: 'tenant-b', name: 'Tenant Beta' };
export const FIREBASE_UID = 'firebase-uid-1';
export const SESSION_EMAIL = 'session-user@example.invalid';

export type SessionUser = {
  userId: string;
  email: string;
  tenantId?: string;
  role?: string;
  activeSiteId?: string | null;
};

export const AGENT_USER: SessionUser = {
  userId: FIREBASE_UID,
  email: SESSION_EMAIL,
  tenantId: TENANT_A.id,
  role: 'ADMIN',
  activeSiteId: 'site-a1',
};

export function createService() {
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
        async (args: { where: { id: string } }) =>
          tenants[args.where.id] ?? null,
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
  const mcpUserLocale = {
    resolveEffectiveLocaleForSession: jest.fn().mockResolvedValue('de'),
  };
  const service = new McpCapabilitiesService(
    agentPolicy as unknown as AgentPolicyService,
    decisionLiveApply as unknown as DecisionLiveApplyService,
    prisma as unknown as PrismaService,
    siteContext as unknown as SiteContextService,
    systemPrisma as unknown as SystemPrismaService,
    tenantContext as unknown as TenantContextService,
    mcpUserLocale as unknown as McpUserLocaleService,
  );
  return {
    service,
    authenticated,
    agentPolicy,
    decisionLiveApply,
    prisma,
    siteContext,
    systemPrisma,
    mcpUserLocale,
  };
}

/**
 * The capability rows `get_capabilities` returns to a session role, paged through to the end and
 * including the AUT-605 compliance and AUT-615 wave-2 reads.
 */
export async function listCapabilitiesForRole(
  role: string,
): Promise<McpCapability[]> {
  const { service, authenticated } = createService();
  authenticated.user = { ...AGENT_USER, role };

  const rows: McpCapability[] = [];
  let cursor: string | undefined;
  do {
    const page = await getCapabilitiesWithWave2Reads(
      service,
      cursor === undefined ? {} : { cursor },
      role,
    );
    rows.push(...page.data);
    cursor = page.meta.next_cursor ?? undefined;
  } while (cursor !== undefined);
  return rows;
}
