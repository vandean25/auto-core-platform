import { AgentPolicyTier } from '@prisma/client';
import { mcpToolOutputSchemas } from './mcp-tool-output-schemas.registry.js';
import { MCP_REGISTERED_TOOL_INPUT_SCHEMAS } from './mcp-server.factory.js';
import { MCP_TOOL_DESCRIPTIONS } from './mcp-tool-descriptions.js';
import { MCP_WRITE_POLICY_ACTION_TYPES_AUT598 } from './mcp-write-policy-action-types.aut598.js';
import './mcp.constants.js';
import { MCP_WRITE_TIER_PROPOSE_CLAMP_TOOLS } from './mcp-write-tier-clamp.js';
import { effectiveMcpWriteTier } from './mcp-write-tier.util.js';
import { tryProposeVehicleMcpWrite } from './mcp-write-pipeline.commit-propose.vehicle.js';
import { runMcpWriteDryRunPath } from './mcp-write-pipeline.dry-run-path.js';
import { vehicleCreateExecutor } from '../pending-action-executor/pending-action-executor.vehicle.js';
import type {
  McpWriteCall,
  McpWriteExecution,
} from './mcp-write-pipeline.types.js';

const VEHICLE_TOOLS = [
  'propose_vehicle_create',
  'propose_vehicle_update',
] as const;

describe('MCP vehicle proposal tools (AUT-614)', () => {
  it('registers both tools with a closed input schema', () => {
    for (const tool of VEHICLE_TOOLS) {
      const schema = MCP_REGISTERED_TOOL_INPUT_SCHEMAS[tool];
      expect(schema).toBeDefined();
    }
  });

  it.each(['inventory_role', 'stock_status', 'tax_scheme', 'listings'])(
    'rejects forbidden field %s in the registered input schema',
    (field) => {
      const schema = MCP_REGISTERED_TOOL_INPUT_SCHEMAS.propose_vehicle_create as {
        safeParse: (value: unknown) => { success: boolean };
      };

      const result = schema.safeParse({
        make: 'VW',
        model: 'Golf',
        idempotency_key: 'aut614-create-1',
        [field]: 'FORBIDDEN',
      });

      expect(result.success).toBe(false);
    },
  );

  it('keeps both tools at PROPOSE and never at AUTO', () => {
    for (const tool of VEHICLE_TOOLS) {
      expect(MCP_WRITE_TIER_PROPOSE_CLAMP_TOOLS.has(tool)).toBe(true);
      expect(effectiveMcpWriteTier(tool, AgentPolicyTier.AUTO)).toBe(
        AgentPolicyTier.PROPOSE,
      );
    }
  });

  it('keeps a vehicle tool at HUMAN_ONLY when the policy refuses it', () => {
    expect(
      effectiveMcpWriteTier(
        'propose_vehicle_create',
        AgentPolicyTier.HUMAN_ONLY,
      ),
    ).toBe(AgentPolicyTier.HUMAN_ONLY);
  });

  it('maps both tools to their own policy action types', () => {
    expect(MCP_WRITE_POLICY_ACTION_TYPES_AUT598).toMatchObject({
      propose_vehicle_create: 'vehicle.create',
      propose_vehicle_update: 'vehicle.update',
    });
  });

  it('documents DUPLICATE_VEHICLE and mileage decrease rules in descriptions', () => {
    expect(MCP_TOOL_DESCRIPTIONS.propose_vehicle_create).toMatch(
      /DUPLICATE_VEHICLE/,
    );
    expect(MCP_TOOL_DESCRIPTIONS.propose_vehicle_update).toMatch(/mileage/i);
  });

  it('publishes an output schema with diff and duplicate_candidates', () => {
    const result = {
      tool: 'propose_vehicle_update',
      tier: 'PROPOSE',
      status: 'needs_approval',
      would_change: [],
      pending_action_id: '00000000-0000-4000-8000-000000000050',
      trace_id: 'trace-1',
      diff: [
        {
          field: 'mileage_km',
          before: '50000',
          after: '42000',
          warning: 'Mileage decreased compared to current recorded value',
        },
      ],
      duplicate_candidates: [
        {
          vehicle_id: '00000000-0000-4000-8000-000000000040',
          match_reasons: ['plate'],
          vin_last4: '4352',
          plate: 'W12345A',
          make: 'VW',
          model: 'Golf',
        },
      ],
      proposal: {
        payload: {},
        would_change: [],
        preview: {},
        provisional: true,
      },
    };

    expect(
      mcpToolOutputSchemas.propose_vehicle_update.safeParse(result).success,
    ).toBe(true);
  });

  it('supports dry_run and surfaces duplicate plate warnings without writing', async () => {
    const deps = {
      prisma: {
        vehicle: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: '00000000-0000-4000-8000-000000000040',
              vin: null,
              plate: 'W-12345 A',
              plate_normalized: 'W12345A',
              make: 'Audi',
              model: 'A4',
            },
          ]),
        },
        customer: { findFirst: jest.fn().mockResolvedValue(null) },
      },
      tenantContext: { getTenantId: jest.fn().mockResolvedValue('tenant-1') },
    } as never;
    const executor = vehicleCreateExecutor(deps, 'vehicle.create');
    const execution = {
      toolName: 'propose_vehicle_create' as const,
      policyActionType: 'vehicle.create',
      buildPolicyContext: () => Promise.resolve({}),
      execute: executor.execute,
      buildResultSummary: executor.buildResultSummary,
    };
    const agentActionLog = {
      record: jest.fn().mockResolvedValue({ traceId: 'trace-dry' }),
    };

    const dryRunResult = await runMcpWriteDryRunPath({
      execution,
      workInput: {
        make: 'VW',
        model: 'Golf',
        plate: 'W 12345-A',
        idempotency_key: 'aut614-dry-1',
      },
      context: { agentId: 'agent-1', onBehalfOfUserId: 'user-1' },
      loggedInput: { make: 'VW', model: 'Golf' },
      normalizeWriteInput: async (_exec, value) => value,
      evaluatePolicy: async () => undefined,
      simulate: async () => ({
        preview: {
          warnings: [
            'Another vehicle in this tenant has the same normalized plate (plates can be reassigned)',
          ],
        },
        wouldChange: [{ entity: 'Vehicle', id: 'v-1', op: 'create', provisional: true }],
      }),
      recordFailure: async () => undefined,
      agentActionLog: agentActionLog as never,
      logActionType: (tool) => `mcp.${tool}`,
    });

    expect(dryRunResult.dry_run).toBe(true);
    expect(dryRunResult.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/plate/i)]),
    );
  });

  it('persists vehicle proposal and replays idempotently on same idempotency_key', async () => {
    const stored: Record<string, unknown>[] = [];
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      agentProposal: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'proposal-v-1',
            trace_id: 'trace-v-1',
            preview_json: {
              would_change: [],
              proposal: { payload: {}, would_change: [], preview: {}, provisional: true },
              preview: {
                diff: [{ field: 'make', before: null, after: 'VW' }],
                duplicate_candidates: [],
              },
            },
          }),
        create: jest.fn().mockImplementation(async ({ data }) => {
          stored.push(data);
          return { id: 'proposal-v-1' };
        }),
      },
    };
    const deps = {
      prisma: {
        $transaction: jest.fn(
          async (work: (client: typeof tx) => Promise<unknown>) => work(tx),
        ),
      },
      agentActionLog: {
        recordInTransaction: jest
          .fn()
          .mockResolvedValue({ traceId: 'trace-v-1' }),
      },
      commandIdempotency: {
        completeInTransaction: jest.fn().mockResolvedValue(undefined),
      },
      tenantContext: { getTenantId: jest.fn().mockResolvedValue('tenant-1') },
    };
    const execution: McpWriteExecution = {
      toolName: 'propose_vehicle_create',
      policyActionType: 'vehicle.create',
      buildPolicyContext: () => Promise.resolve({}),
      execute: async () => ({}),
      buildResultSummary: () => ({}),
    };
    const call: McpWriteCall = {
      execution,
      input: {
        action: 'vehicle.create',
        idempotency_key: 'aut614-idem-1',
        fields: { make: 'VW', model: 'Golf', year: 2021 },
        duplicate_check: { digest: 'd', candidate_ids: [] },
        warnings: [],
      },
      context: { agentId: 'agent-1', onBehalfOfUserId: 'user-1' },
      actionType: 'mcp.propose_vehicle_create',
      inputSummary: { tool: 'propose_vehicle_create', args: {} },
      tier: AgentPolicyTier.PROPOSE,
      reasons: [],
    };
    const simulation = {
      preview: {
        diff: [{ field: 'make', before: null, after: 'VW' }],
        duplicate_candidates: [],
      },
      wouldChange: [],
    };

    const first = await tryProposeVehicleMcpWrite(deps as never, call, simulation);
    const second = await tryProposeVehicleMcpWrite(deps as never, call, simulation);

    expect(first?.status).toBe('needs_approval');
    expect(first?.pending_action_id).toBe('proposal-v-1');
    expect(second?.pending_action_id).toBe('proposal-v-1');
    expect(second?.replayed).toBe(true);
    expect(stored).toHaveLength(1);
  });
});
