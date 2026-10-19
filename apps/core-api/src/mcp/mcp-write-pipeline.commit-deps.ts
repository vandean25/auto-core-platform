import type { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import type { AgentPolicyService } from '../agent-policy/agent-policy.service.js';
import type { DryRunService } from '../dry-run/dry-run.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { McpWriteCommandIdempotencyService } from './mcp-write-command-idempotency.service.js';
import type { MechanicFindingProposeService } from '../mechanic/mechanic-finding-propose.service.js';
import type { WorkshopMediaUploadMcpService } from '../mechanic/workshop-media-upload-mcp.service.js';
import type { WeeklyReportMcpService } from '../reports/weekly-report/weekly-report-mcp.service.js';
import type { WorkshopEstimateSendProposeService } from '../workshop/workshop-estimate-send-propose.service.js';

export type McpWritePipelineCommitDeps = {
  prisma: PrismaService;
  agentPolicy: AgentPolicyService;
  dryRun: DryRunService;
  agentActionLog: AgentActionLogService;
  tenantContext: TenantContextService;
  commandIdempotency: McpWriteCommandIdempotencyService;
  mechanicFindingPropose: MechanicFindingProposeService;
  workshopEstimateSendPropose: WorkshopEstimateSendProposeService;
  workshopMediaUploadMcp: WorkshopMediaUploadMcpService;
  weeklyReportMcp: WeeklyReportMcpService;
};
