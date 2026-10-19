import type { WouldChangeItem } from '../dry-run/dry-run.types.js';
import type { WorkshopMediaUploadMcpService } from '../mechanic/workshop-media-upload-mcp.service.js';
import type { WeeklyReportMcpService } from '../reports/weekly-report/weekly-report-mcp.service.js';
import {
  bindEstimateSendPreviewHost,
  runEstimateSendPreview,
} from '../workshop/workshop-estimate-send-propose.preview.js';
import type { WorkshopEstimateSendProposeService } from '../workshop/workshop-estimate-send-propose.service.js';
import type { McpWriteCall } from './mcp-write-pipeline.types.js';
import type { McpWriteToolName } from './mcp.constants.js';
import { requestWorkshopMediaUploadInputSchema } from '../mechanic/mechanic-finding-propose.schema.js';
import { generateWeeklyReportPdfInputSchema } from '../reports/weekly-report/weekly-report-mcp.schema.js';

const DRY_RUN_PREVIEW_TOOLS = new Set<McpWriteToolName>([
  'propose_estimate_send',
  'request_workshop_media_upload',
  'generate_weekly_report_pdf',
]);

export function usesDedicatedDryRunPreview(tool: McpWriteToolName): boolean {
  return DRY_RUN_PREVIEW_TOOLS.has(tool);
}

export type McpWriteDryRunPreviewDeps = {
  workshopEstimateSendPropose: WorkshopEstimateSendProposeService;
  workshopMediaUploadMcp: WorkshopMediaUploadMcpService;
  weeklyReportMcp: WeeklyReportMcpService;
};

export async function simulateDedicatedDryRunPreview(
  deps: McpWriteDryRunPreviewDeps,
  call: McpWriteCall,
  executionContext?: Record<string, unknown>,
): Promise<{ result: unknown; wouldChange: WouldChangeItem[] }> {
  switch (call.execution.toolName) {
    case 'propose_estimate_send': {
      const previewSend = (
        deps.workshopEstimateSendPropose as WorkshopEstimateSendProposeService & {
          previewSend?: (
            input: unknown,
            executionContext?: Record<string, unknown>,
          ) => Promise<unknown>;
        }
      ).previewSend;
      const result = previewSend
        ? await previewSend.call(
            deps.workshopEstimateSendPropose,
            call.input,
            executionContext,
          )
        : await runEstimateSendPreview(
            bindEstimateSendPreviewHost(deps.workshopEstimateSendPropose),
            call.input,
            executionContext,
          );
      return { result, wouldChange: [] };
    }
    case 'request_workshop_media_upload': {
      const parsed = requestWorkshopMediaUploadInputSchema.parse(call.input);
      const result = await deps.workshopMediaUploadMcp.previewUploadSlot(parsed);
      return { result, wouldChange: [] };
    }
    case 'generate_weekly_report_pdf': {
      const parsed = generateWeeklyReportPdfInputSchema.parse(call.input);
      const result = await deps.weeklyReportMcp.preview(parsed);
      return { result, wouldChange: [] };
    }
    default:
      throw new Error(
        `No dedicated dry-run preview for ${call.execution.toolName}`,
      );
  }
}
