import type { McpWriteToolName } from './mcp.constants.js';
import {
  buildWriteExecution,
  createPipelineDryRunFixture,
  DRY_RUN_MINIMAL_INPUTS,
  installOutboundSideEffectSpies,
} from './mcp-write-dry-run.contract.spec.support.js';

const REAL_ADAPTER_WRITE_TOOLS: McpWriteToolName[] = [
  'request_workshop_media_upload',
  'generate_weekly_report_pdf',
  'propose_workshop_order_completion',
  'propose_estimate_send',
];

describe('MCP write dry_run real adapter services (AUT-612)', () => {
  let outboundSpies: ReturnType<typeof installOutboundSideEffectSpies>;

  beforeEach(() => {
    outboundSpies = installOutboundSideEffectSpies();
  });

  afterEach(() => {
    outboundSpies.restore();
  });

  it.each(REAL_ADAPTER_WRITE_TOOLS)(
    '%s: dry_run uses real services without low-level outbound calls',
    async (toolName) => {
      const fixture = await createPipelineDryRunFixture({
        useRealAdapters: true,
      });
      expect(fixture.realAdapterSpies).not.toBeNull();

      const result = await fixture.service.run(
        buildWriteExecution(toolName, fixture.executors),
        {
          dry_run: true,
          command_id: '51500000-0000-4000-8000-000000000602',
          ...(DRY_RUN_MINIMAL_INPUTS[toolName] ?? {}),
        },
        fixture.mockContext,
      );

      expect(result).toMatchObject({ dry_run: true, tool: toolName });
      fixture.realAdapterSpies!.assertQuiet();
      if (toolName === 'propose_estimate_send') {
        fixture.realAdapterSpies!.assertQuietAfterEstimateDryRun();
        expect(fixture.mockCommandIdempotency.beginOrReplay).not.toHaveBeenCalled();
        expect(fixture.mockPrisma.mcpWriteCommandReceipt.create).not.toHaveBeenCalled();
      }
      outboundSpies.assertNoOutboundSideEffects();
      fixture.realAdapterSpies!.restoreGlobals();
    },
  );

  it('request_workshop_media_upload dry_run calls real previewUploadSlot', async () => {
    const fixture = await createPipelineDryRunFixture({
      useRealAdapters: true,
    });
    const previewSpy = jest.spyOn(
      fixture.mockWorkshopMediaUploadMcp,
      'previewUploadSlot',
    );

    const result = await fixture.service.run(
      buildWriteExecution('request_workshop_media_upload', fixture.executors),
      {
        dry_run: true,
        workshop_task_id: '00000000-0000-4000-8000-000000000006',
        mime_type: 'image/jpeg',
        size_bytes: 1024,
        purpose: 'MECHANIC_FINDING',
      },
      fixture.mockContext,
    );

    expect(previewSpy).toHaveBeenCalled();
    expect(result).toMatchObject({
      dry_run: true,
      preview: expect.objectContaining({
        dry_run_preview: true,
        upload_url: null,
      }),
    });
    fixture.realAdapterSpies!.assertQuiet();
    previewSpy.mockRestore();
    fixture.realAdapterSpies!.restoreGlobals();
  });

  it('propose_estimate_send dry_run previews without sendVersion', async () => {
    const fixture = await createPipelineDryRunFixture({
      useRealAdapters: true,
    });
    expect(fixture.realWorkshopEstimateSendPropose).not.toBeNull();

    const result = await fixture.service.run(
      buildWriteExecution('propose_estimate_send', fixture.executors),
      {
        dry_run: true,
        command_id: '51500000-0000-4000-8000-000000000603',
        ...(DRY_RUN_MINIMAL_INPUTS.propose_estimate_send ?? {}),
      },
      fixture.mockContext,
    );

    expect(result).toMatchObject({
      dry_run: true,
      tool: 'propose_estimate_send',
      preview: expect.objectContaining({
        estimate_version_id: expect.any(String),
      }),
    });
    fixture.realAdapterSpies!.assertQuietAfterEstimateDryRun();
    fixture.realAdapterSpies!.restoreGlobals();
  });
});
