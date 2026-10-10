import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AgentPolicyTier } from '@prisma/client';
import { MCP_WRITE_POLICY_ACTION_TYPES } from '../agent-policy/agent-policy.constants.js';
import { evaluateAgentPolicy } from '../agent-policy/agent-policy.evaluator.js';
import { AgentPolicyService } from '../agent-policy/agent-policy.service.js';
import { SiteContextService } from '../common/services/site-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { DecisionLiveApplyService } from '../decision/decision-live-apply.service.js';
import type { DecisionApplyMode } from '../decision/decision.constants.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import {
  MCP_CAPABILITIES_DEFAULT_PAGE_SIZE,
  MCP_NEVER_EXPOSED_ACTIONS,
  MCP_READ_TOOL_NAMES,
  MCP_SUPERVISOR_READ_TOOL_NAMES,
  MCP_WRITE_TOOL_NAMES,
  type McpToolName,
  type McpWriteToolName,
} from './mcp.constants.js';
import { isMcpSupervisorRole } from './mcp.authorization.js';
import { resolveMcpAgentName } from './mcp-agent-id.util.js';
import { decodeMcpCursor, encodeMcpCursor } from './mcp-output.util.js';
import { MCP_TOOL_DESCRIPTIONS } from './mcp-tool-descriptions.js';
import { effectiveMcpWriteTier } from './mcp-write-tier.util.js';

export type McpCallerType = 'agent' | 'human_on_behalf';

export type McpWhoami = {
  caller: { id: string; name: string | null; type: McpCallerType };
  role: string | null;
  tenant: { id: string; name: string };
  site: { id: string; name: string } | null;
  mode: DecisionApplyMode;
};

/** Base tier from policy. A call can still escalate AUTO to PROPOSE from its own context. */
export type McpCapabilityTier = 'AUTO' | 'PROPOSE';

export type McpCapability = {
  tool: McpToolName;
  description: string;
  tier: McpCapabilityTier;
  access: 'read' | 'write';
  enabled: boolean;
  disabled_reason?: 'policy_disabled' | 'role_not_permitted';
};

export type McpCapabilitiesPage = {
  data: McpCapability[];
  meta: { total: number; page_size: number; next_cursor: string | null };
  human_only_actions: string[];
};

type WriteToolDescription =
  | { kind: 'tool'; capability: McpCapability }
  | { kind: 'human_only'; actionType: string };

@Injectable()
export class McpCapabilitiesService {
  constructor(
    private readonly agentPolicy: AgentPolicyService,
    private readonly decisionLiveApply: DecisionLiveApplyService,
    private readonly prisma: PrismaService,
    private readonly siteContext: SiteContextService,
    private readonly systemPrisma: SystemPrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Identity of the session. An agent session reports the agent as caller; the
   * role, tenant, and site are those of the human the agent acts for. Everything
   * comes from the session, never from tool arguments.
   */
  async whoami(session: { agentId?: string }): Promise<McpWhoami> {
    const user = this.tenantContext.getAuthenticatedUser();
    if (!user?.tenantId) {
      throw new ForbiddenException('MCP requires an active tenant membership');
    }
    const tenantId = user.tenantId;
    const [caller, tenant, site, mode] = await Promise.all([
      this.resolveCaller(session.agentId, user.userId),
      this.loadTenant(tenantId),
      this.loadActiveSite(tenantId),
      this.decisionLiveApply.resolveEffectiveMode(tenantId),
    ]);
    return { caller, role: user.role ?? null, tenant, site, mode };
  }

  /**
   * Tools the caller can see, with tier and enabled state from the agent policy.
   * HUMAN_ONLY actions are never listed as tools; their policy names are returned
   * in human_only_actions so the agent can ask a person to act.
   */
  async getCapabilities(input: {
    pageSize?: number;
    cursor?: string;
  }): Promise<McpCapabilitiesPage> {
    const pageSize = input.pageSize ?? MCP_CAPABILITIES_DEFAULT_PAGE_SIZE;
    const offset =
      input.cursor === undefined ? 0 : (decodeMcpCursor(input.cursor) ?? 0);
    const { tools, humanOnlyActions } = await this.buildCatalog(
      this.tenantContext.getAuthenticatedUser()?.role,
    );
    const nextOffset = offset + pageSize;
    return {
      data: tools.slice(offset, nextOffset),
      meta: {
        total: tools.length,
        page_size: pageSize,
        next_cursor:
          nextOffset < tools.length ? encodeMcpCursor(nextOffset) : null,
      },
      human_only_actions: humanOnlyActions,
    };
  }

  private async resolveCaller(
    agentId: string | undefined,
    firebaseUid: string,
  ): Promise<McpWhoami['caller']> {
    if (agentId) {
      return { id: agentId, name: resolveMcpAgentName(agentId), type: 'agent' };
    }
    const human = await this.systemPrisma.user.findUnique({
      where: { firebaseUid },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!human) {
      throw new NotFoundException('Caller user not found');
    }
    const name = [human.firstName, human.lastName].filter(Boolean).join(' ');
    return { id: human.id, name: name || null, type: 'human_on_behalf' };
  }

  private async loadTenant(tenantId: string): Promise<McpWhoami['tenant']> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true },
    });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    return tenant;
  }

  private async loadActiveSite(tenantId: string): Promise<McpWhoami['site']> {
    const siteId = await this.siteContext.findSiteId();
    if (!siteId) {
      return null;
    }
    return this.prisma.site.findFirst({
      where: { id: siteId, tenant_id: tenantId },
      select: { id: true, name: true },
    });
  }

  /**
   * Read tools that show other users' activity are enabled only for the roles in
   * MCP_SUPERVISOR_ROLES. For any other caller they are listed with enabled false
   * and the reason, so the catalog matches what each call will accept.
   */
  private async buildCatalog(role: string | undefined): Promise<{
    tools: McpCapability[];
    humanOnlyActions: string[];
  }> {
    const supervisorOnly = new Set<string>(MCP_SUPERVISOR_READ_TOOL_NAMES);
    const isSupervisor = isMcpSupervisorRole(role);
    const tools: McpCapability[] = MCP_READ_TOOL_NAMES.map(
      (tool): McpCapability => {
        const entry = {
          tool,
          description: MCP_TOOL_DESCRIPTIONS[tool],
          tier: 'AUTO' as const,
          access: 'read' as const,
        };
        if (supervisorOnly.has(tool) && !isSupervisor) {
          return {
            ...entry,
            enabled: false,
            disabled_reason: 'role_not_permitted',
          };
        }
        return { ...entry, enabled: true };
      },
    );
    const humanOnlyActions = new Set<string>(MCP_NEVER_EXPOSED_ACTIONS);
    for (const tool of MCP_WRITE_TOOL_NAMES) {
      const described = await this.describeWriteTool(tool);
      if (described.kind === 'tool') {
        tools.push(described.capability);
      } else {
        humanOnlyActions.add(described.actionType);
      }
    }
    return { tools, humanOnlyActions: [...humanOnlyActions].sort() };
  }

  /**
   * A disabled rule stays listed with enabled=false and its configured tier, so
   * the caller can see why it is unavailable. A missing rule, a floor category,
   * or a configured HUMAN_ONLY tier is fail-closed and is not a tool.
   *
   * The tier is what a call with no per-call context would enforce. The evaluator
   * applies the rule's own customer_facing condition, so that escalation shows here.
   */
  private async describeWriteTool(
    tool: McpWriteToolName,
  ): Promise<WriteToolDescription> {
    const actionType = MCP_WRITE_POLICY_ACTION_TYPES[tool];
    const rule = await this.agentPolicy.getEffectiveRule(actionType);
    if (!rule) {
      return { kind: 'human_only', actionType };
    }
    const configured = evaluateAgentPolicy(
      actionType,
      {},
      { ...rule, enabled: true },
    ).tier;
    const tier = effectiveMcpWriteTier(tool, configured);
    if (tier === AgentPolicyTier.HUMAN_ONLY) {
      return { kind: 'human_only', actionType };
    }
    const base = {
      tool,
      description: MCP_TOOL_DESCRIPTIONS[tool],
      tier,
      access: 'write' as const,
    };
    const capability: McpCapability = rule.enabled
      ? { ...base, enabled: true }
      : { ...base, enabled: false, disabled_reason: 'policy_disabled' };
    return { kind: 'tool', capability };
  }
}
