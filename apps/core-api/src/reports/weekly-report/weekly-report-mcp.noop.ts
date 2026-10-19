import type { WeeklyReportMcpService } from './weekly-report-mcp.service.js';

export const weeklyReportMcpNoop = {
  preview: () =>
    Promise.reject(new Error('WeeklyReportMcpService is not configured')),
  execute: () =>
    Promise.reject(new Error('WeeklyReportMcpService is not configured')),
  refreshReplayResult: () =>
    Promise.reject(new Error('WeeklyReportMcpService is not configured')),
} satisfies Pick<
  WeeklyReportMcpService,
  'preview' | 'execute' | 'refreshReplayResult'
>;
