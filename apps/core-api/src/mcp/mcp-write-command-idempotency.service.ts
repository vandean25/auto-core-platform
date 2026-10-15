import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  AgentPolicyTier,
  AgentProposalStatus,
  McpWriteCommandReceiptStatus,
  Prisma,
} from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import type { McpWriteToolName } from './mcp.constants.js';
import type { McpWriteToolContext, McpWriteToolResult } from './mcp-write-pipeline.service.js';

export const MCP_COMMAND_IDEMPOTENCY_CONFLICT =
  'MCP_COMMAND_IDEMPOTENCY_CONFLICT';

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
};

@Injectable()
export class McpWriteCommandIdempotencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {}

  /**
   * Claims a command id or returns a replayable completed result after today's auth checks.
   * Throws on fingerprint/tool/site/on-behalf mismatch for the same key.
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
      return {
        kind: 'replay',
        result: await this.replayFromReceipt(existing, {
          toolName: input.toolName,
          argsFingerprint: input.argsFingerprint,
          context: input.context,
          siteId,
        }),
      };
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
      return {
        kind: 'replay',
        result: await this.replayFromReceipt(raced, {
          toolName: input.toolName,
          argsFingerprint: input.argsFingerprint,
          context: input.context,
          siteId,
        }),
      };
    }
  }

  async complete(
    claim: McpWriteCommandClaim,
    result: McpWriteToolResult,
  ): Promise<void> {
    const tenantId = await this.tenantContext.getTenantId();
    await this.prisma.mcpWriteCommandReceipt.updateMany({
      where: {
        id: claim.receiptId,
        tenant_id: tenantId,
        status: McpWriteCommandReceiptStatus.IN_FLIGHT,
      },
      data: {
        status: McpWriteCommandReceiptStatus.COMPLETED,
        original_trace_id: result.trace_id ?? claim.originalTraceId,
        response_json: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue,
      },
    });
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

  private async replayFromReceipt(
    receipt: ReceiptRow,
    input: {
      toolName: McpWriteToolName;
      argsFingerprint: string;
      context: McpWriteToolContext;
      siteId: string | null;
    },
  ): Promise<McpWriteToolResult> {
    this.assertReceiptOwnership(receipt, input);
    this.assertReceiptFingerprint(receipt, input);

    if (receipt.status === McpWriteCommandReceiptStatus.COMPLETED) {
      return this.markReplayed(
        receipt.response_json as unknown as McpWriteToolResult,
        receipt.original_trace_id,
      );
    }

    const reconciled = await this.reconcileInFlight(receipt);
    if (reconciled) {
      await this.prisma.mcpWriteCommandReceipt.update({
        where: { id: receipt.id },
        data: {
          status: McpWriteCommandReceiptStatus.COMPLETED,
          response_json: JSON.parse(
            JSON.stringify(reconciled),
          ) as Prisma.InputJsonValue,
        },
      });
      return this.markReplayed(reconciled, receipt.original_trace_id);
    }

    throw new ConflictException({
      code: 'MCP_COMMAND_IN_FLIGHT',
      message:
        'A command with this id is still executing; retry with the same command_id shortly.',
    });
  }

  private assertReceiptOwnership(
    receipt: ReceiptRow,
    input: {
      context: McpWriteToolContext;
      siteId: string | null;
    },
  ): void {
    if (
      receipt.on_behalf_of_user_id !== input.context.onBehalfOfUserId ||
      receipt.agent_id !== input.context.agentId
    ) {
      throw new ForbiddenException(
        'This command_id belongs to another caller identity.',
      );
    }
    if (receipt.site_id !== null && receipt.site_id !== input.siteId) {
      throw new ForbiddenException(
        'This command_id was recorded for a different active site.',
      );
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

  private async reconcileInFlight(
    receipt: ReceiptRow,
  ): Promise<McpWriteToolResult | null> {
    const proposal = await this.prisma.agentProposal.findFirst({
      where: {
        tenant_id: receipt.tenant_id,
        trace_id: receipt.original_trace_id,
        status: AgentProposalStatus.PENDING,
      },
    });
    if (proposal) {
      const preview = (proposal.preview_json ?? {}) as Record<string, unknown>;
      return {
        tool: receipt.tool_name as McpWriteToolName,
        tier: proposal.tier,
        status: 'needs_approval',
        would_change: (preview.would_change ?? []) as McpWriteToolResult['would_change'],
        proposal: {
          payload: proposal.payload_json,
          would_change: (preview.would_change ?? []) as McpWriteToolResult['would_change'],
          preview: preview.preview,
          provisional: true,
        },
        pending_action_id: proposal.id,
        trace_id: receipt.original_trace_id,
      };
    }

    const executedLog = await this.prisma.agentActionLog.findFirst({
      where: {
        tenant_id: receipt.tenant_id,
        trace_id: receipt.original_trace_id,
        status: 'EXECUTED',
        action_type: `mcp.${receipt.tool_name}`,
      },
    });
    if (executedLog?.result_summary_json) {
      const summary = executedLog.result_summary_json as Record<string, unknown>;
      return {
        tool: receipt.tool_name as McpWriteToolName,
        tier: executedLog.tier as AgentPolicyTier,
        status: 'executed',
        would_change: [],
        result: summary,
        trace_id: receipt.original_trace_id,
      };
    }

    return null;
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

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}
