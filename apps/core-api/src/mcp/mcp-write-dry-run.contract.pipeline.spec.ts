import { AgentPolicyTier } from '@prisma/client';
import { mcpToolOutputSchemas } from './mcp-tool-output-schemas.registry.js';
import { mcpWriteDryRunResultSchema } from './mcp-write-dry-run.schema.js';
import { toMcpJsonObject } from './mcp-output.util.js';
import {
  buildWriteExecution,
  createPipelineDryRunFixture,
  DRY_RUN_MINIMAL_INPUTS,
  installOutboundSideEffectSpies,
  MCP_WRITE_TOOL_NAMES,
} from './mcp-write-dry-run.contract.spec.support.js';

describe('MCP write dry_run pipeline (AUT-612)', () => {
  let fixture: Awaited<ReturnType<typeof createPipelineDryRunFixture>>;
  let outboundSpies: ReturnType<typeof installOutboundSideEffectSpies>;

  beforeEach(async () => {
    outboundSpies = installOutboundSideEffectSpies();
    fixture = await createPipelineDryRunFixture();
  });

  afterEach(() => {
    outboundSpies.restore();
  });

  it.each(MCP_WRITE_TOOL_NAMES)(
    '%s: dry_run uses executor, skips commits, and blocks outbound side effects',
    async (toolName) => {
      const execution = buildWriteExecution(toolName, fixture.executors);
      const businessInput = DRY_RUN_MINIMAL_INPUTS[toolName] ?? {};
      const result = await fixture.service.run(
        execution,
        {
          dry_run: true,
          command_id: '51500000-0000-4000-8000-000000000601',
          ...businessInput,
        },
        fixture.mockContext,
      );

      expect(result).toMatchObject({ dry_run: true, tool: toolName });
      expect(mcpWriteDryRunResultSchema.safeParse(result).success).toBe(true);
      expect(
        mcpToolOutputSchemas[toolName].safeParse(toMcpJsonObject(result)).success,
      ).toBe(true);
      expect(fixture.mockCommandIdempotency.beginOrReplay).not.toHaveBeenCalled();
      expect(fixture.mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(fixture.mockAgentActionLog.recordInTransaction).not.toHaveBeenCalled();
      expect(fixture.txAgentProposalCreate).not.toHaveBeenCalled();
      expect(fixture.mockPrisma.mcpWriteCommandReceipt.create).not.toHaveBeenCalled();
      expect(fixture.mockAgentActionLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'DRY_RUN' }),
      );
      outboundSpies.assertNoOutboundSideEffects();
    },
  );

  it('request_workshop_media_upload dry_run does not mint upload credentials', async () => {
    const execution = buildWriteExecution(
      'request_workshop_media_upload',
      fixture.executors,
    );
    const result = await fixture.service.run(
      execution,
      {
        dry_run: true,
        workshop_task_id: '00000000-0000-4000-8000-000000000006',
        mime_type: 'image/jpeg',
        size_bytes: 1024,
        purpose: 'MECHANIC_FINDING',
      },
      fixture.mockContext,
    );

    expect(fixture.mockWorkshopMediaUploadMcp.previewUploadSlot).toHaveBeenCalled();
    expect(fixture.mockWorkshopMediaUploadMcp.createUploadSlot).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      dry_run: true,
      preview: expect.objectContaining({
        dry_run_preview: true,
        upload_url: null,
        fields: {},
      }),
    });
    outboundSpies.assertNoOutboundSideEffects();
  });

  it('HUMAN_ONLY dry_run returns policy_decision without preview data', async () => {
    fixture.mockAgentPolicy.evaluateAction.mockResolvedValue({
      tier: AgentPolicyTier.HUMAN_ONLY,
      reasons: ['policy_disabled'],
      rule_id: 'rule-off',
      rule_version: 1,
    });

    const result = await fixture.service.run(
      buildWriteExecution('reserve_part', fixture.executors),
      {
        dry_run: true,
        workshop_task_line_item_id: '00000000-0000-4000-8000-000000000004',
        quantity: 1,
        location_id: '00000000-0000-4000-8000-000000000005',
      },
      fixture.mockContext,
    );

    expect(result).toMatchObject({
      dry_run: true,
      would_change: [],
      preview: null,
      policy_decision: {
        tier: 'HUMAN_ONLY',
        reasons: ['policy_disabled'],
      },
    });
    outboundSpies.assertNoOutboundSideEffects();
  });
});
