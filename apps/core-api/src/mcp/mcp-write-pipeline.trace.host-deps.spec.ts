import { mcpWriteTracePipelineHostDeps } from './mcp-write-pipeline.trace.spec.support.js';

describe('McpWritePipelineService trace host deps', () => {
  it('types estimate send, media upload, and weekly report ctor stubs', () => {
    const deps = mcpWriteTracePipelineHostDeps();
    expect(deps.workshopEstimateSendPropose.enrichInput).toBeDefined();
    expect(deps.workshopMediaUploadMcp.previewUploadSlot).toBeDefined();
    expect(deps.weeklyReportMcp.preview).toBeDefined();
  });
});
