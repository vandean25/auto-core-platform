import { AgentPolicyTier } from '@prisma/client';
import { mcpToolOutputSchemas } from './mcp-tool-output-schemas.registry.js';
import { MCP_REGISTERED_TOOL_INPUT_SCHEMAS } from './mcp-server.factory.js';
import { MCP_TOOL_DESCRIPTIONS } from './mcp-tool-descriptions.js';
import { MCP_WRITE_POLICY_ACTION_TYPES_AUT598 } from './mcp-write-policy-action-types.aut598.js';
import './mcp.constants.js';
import { MCP_WRITE_TIER_PROPOSE_CLAMP_TOOLS } from './mcp-write-tier-clamp.js';
import { effectiveMcpWriteTier } from './mcp-write-tier.util.js';
import { proposeMcpWriteViaPersist } from './mcp-write-pipeline.commit-propose.persist-path.js';
import { runMcpWriteDryRunPath } from './mcp-write-pipeline.dry-run-path.js';
import { maskLoggedArgs } from './mcp-write-pipeline.mask.js';
import { mapExecutorHooks } from './mcp-write-execution-hooks.js';
import {
  customerCreateExecutor,
} from '../pending-action-executor/pending-action-executor.customer.js';
import type { McpWriteCall } from './mcp-write-pipeline.types.js';

const CUSTOMER_TOOLS = [
  'propose_customer_create',
  'propose_customer_update',
] as const;

describe('MCP customer proposal tools (AUT-613)', () => {
  it('registers both tools with a closed input schema', () => {
    for (const tool of CUSTOMER_TOOLS) {
      const schema = MCP_REGISTERED_TOOL_INPUT_SCHEMAS[tool];
      expect(schema).toBeDefined();
    }
  });

  it('rejects a consent field in the registered input schema', () => {
    const schema = MCP_REGISTERED_TOOL_INPUT_SCHEMAS.propose_customer_create as {
      safeParse: (value: unknown) => { success: boolean };
    };

    const result = schema.safeParse({
      customer_type: 'PRIVATE',
      first_name: 'Max',
      last_name: 'Mustermann',
      idempotency_key: 'aut613-create-1',
      contact_email_ok: true,
    });

    expect(result.success).toBe(false);
  });

  it('keeps both tools at PROPOSE and never at AUTO', () => {
    for (const tool of CUSTOMER_TOOLS) {
      expect(MCP_WRITE_TIER_PROPOSE_CLAMP_TOOLS.has(tool)).toBe(true);
      expect(effectiveMcpWriteTier(tool, AgentPolicyTier.AUTO)).toBe(
        AgentPolicyTier.PROPOSE,
      );
    }
  });

  it('keeps a customer tool at HUMAN_ONLY when the policy refuses it', () => {
    expect(
      effectiveMcpWriteTier(
        'propose_customer_create',
        AgentPolicyTier.HUMAN_ONLY,
      ),
    ).toBe(AgentPolicyTier.HUMAN_ONLY);
  });

  it('maps both tools to their own policy action types', () => {
    expect(MCP_WRITE_POLICY_ACTION_TYPES_AUT598).toMatchObject({
      propose_customer_create: 'customer.create',
      propose_customer_update: 'customer.update',
    });
  });

  it('documents the duplicate check and the consent rule in the descriptions', () => {
    expect(MCP_TOOL_DESCRIPTIONS.propose_customer_create).toMatch(
      /DUPLICATE_CUSTOMER/,
    );
    expect(MCP_TOOL_DESCRIPTIONS.propose_customer_update).toMatch(
      /consent/i,
    );
  });

  it('publishes an output schema with the diff and the duplicate candidates', () => {
    const result = {
      tool: 'propose_customer_update',
      tier: 'PROPOSE',
      status: 'needs_approval',
      would_change: [],
      pending_action_id: '00000000-0000-4000-8000-000000000050',
      trace_id: 'trace-1',
      diff: [
        {
          field: 'email',
          before_masked: 'm***@example.at',
          after_masked: 'n***@example.at',
        },
      ],
      duplicate_candidates: [
        {
          customer_id: '00000000-0000-4000-8000-000000000040',
          match_reasons: ['phone'],
          display_name_initials: 'MM',
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
      mcpToolOutputSchemas.propose_customer_update.safeParse(result).success,
    ).toBe(true);
  });

  it('masks email, phone and address in the action-log inputSummary', async () => {
    const deps = {
      prisma: {
        customer: { findMany: jest.fn().mockResolvedValue([]) },
      },
      tenantContext: { getTenantId: jest.fn().mockResolvedValue('tenant-1') },
      siteContext: { getSiteId: jest.fn().mockResolvedValue('site-1') },
    } as never;
    const executor = customerCreateExecutor(deps, 'customer.create');
    const execution = {
      toolName: 'propose_customer_create' as const,
      policyActionType: 'customer.create',
      buildPolicyContext: () => Promise.resolve({}),
      execute: async () => ({}),
      buildResultSummary: () => ({}),
      ...mapExecutorHooks(executor),
    };
    const rawArgs = {
      customer_type: 'PRIVATE',
      first_name: 'Max',
      last_name: 'Mustermann',
      email: 'max@example.at',
      phone: '+43 664 123456',
      address: { street: 'Mustergasse 1', zip: '1010', city: 'Wien', country: 'AT' },
      idempotency_key: 'aut613-create-1',
      dry_run: true,
    };
    let capturedSummary: { args: Record<string, unknown> } | undefined;
    const agentActionLog = {
      record: jest.fn(async (row: { inputSummary: { args: Record<string, unknown> } }) => {
        capturedSummary = row.inputSummary;
        return { traceId: 'trace-dry', workResult: {} };
      }),
    };

    await runMcpWriteDryRunPath({
      execution,
      workInput: { ...rawArgs, dry_run: undefined, command_id: undefined },
      context: { agentId: 'agent-1', onBehalfOfUserId: 'user-1' },
      loggedInput: maskLoggedArgs(execution, rawArgs),
      normalizeWriteInput: async (_exec, value) => value,
      evaluatePolicy: async () => undefined,
      simulate: async () => ({ preview: {}, wouldChange: [] }),
      recordFailure: async () => undefined,
      agentActionLog: agentActionLog as never,
      logActionType: (tool) => `mcp.${tool}`,
    });

    expect(capturedSummary?.args.email).not.toBe('max@example.at');
    expect(capturedSummary?.args.phone).not.toBe('+43 664 123456');
    expect(capturedSummary?.args.address).toEqual({
      street: '***',
      zip: '***',
      city: '***',
      country: '***',
    });
  });

  describe('proposal persistence', () => {
    it('stores the submitted values and returns the masked copy', async () => {
      const stored: Record<string, unknown>[] = [];
      const tx = {
        $executeRaw: jest.fn().mockResolvedValue(0),
        agentProposal: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockImplementation(async ({ data }) => {
            stored.push(data);
            return { id: 'proposal-1' };
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
          recordInTransaction: jest.fn().mockResolvedValue({ traceId: 'trace-1' }),
        },
        tenantContext: {
          getTenantId: jest.fn().mockResolvedValue('tenant-1'),
        },
        commandIdempotency: { completeInTransaction: jest.fn() },
      } as never;
      const call: McpWriteCall = {
        execution: {
          toolName: 'propose_customer_create',
          policyActionType: 'customer.create',
          buildPolicyContext: () => ({}),
          execute: async () => ({}),
          buildResultSummary: () => ({}),
          maskProposalPayload: (payload: unknown) => ({
            ...(payload as Record<string, unknown>),
            fields: { email: 'm***@example.at' },
          }),
        },
        input: {
          action: 'customer.create',
          idempotency_key: 'aut613-create-1',
          fields: {
            customer_type: 'PRIVATE',
            first_name: 'Max',
            last_name: 'Mustermann',
            email: 'max@example.at',
          },
        },
        context: { agentId: 'agent-1', onBehalfOfUserId: 'user-1' },
        actionType: 'customer.create',
        inputSummary: { tool: 'propose_customer_create', args: {} },
        tier: AgentPolicyTier.PROPOSE,
        reasons: ['policy'],
      };

      const simulation = {
        preview: {
          entity: 'Customer',
          op: 'create',
          diff: [
            {
              field: 'email',
              before_masked: null,
              after_masked: 'm***@example.at',
            },
          ],
          duplicate_candidates: [
            {
              customer_id: '00000000-0000-4000-8000-000000000040',
              match_reasons: ['phone'],
              display_name_initials: 'MM',
            },
          ],
        },
        wouldChange: [],
      };
      const result = await proposeMcpWriteViaPersist(
        deps,
        call,
        simulation,
        {
          proposalActionType: 'customer.create',
          proposalPayload: call.input,
          proposalPreview: simulation.preview,
        },
      );

      expect(stored[0]?.payload_json).toMatchObject({
        fields: { email: 'max@example.at' },
      });
      expect(result.proposal).toMatchObject({
        payload: { fields: { email: 'm***@example.at' } },
      });
      expect(result.diff).toEqual([
        { field: 'email', before_masked: null, after_masked: 'm***@example.at' },
      ]);
      expect(result.duplicate_candidates).toEqual([
        {
          customer_id: '00000000-0000-4000-8000-000000000040',
          match_reasons: ['phone'],
          display_name_initials: 'MM',
        },
      ]);
      expect(result.status).toBe('needs_approval');
    });

    it('replays an existing pending proposal for the same idempotency_key', async () => {
      const existingPreview = {
        would_change: [],
        proposal: { provisional: true },
        preview: {
          diff: [{ field: 'email', before_masked: null, after_masked: 'm***@example.at' }],
        },
      };
      const tx = {
        $executeRaw: jest.fn().mockResolvedValue(0),
        agentProposal: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'proposal-existing',
            trace_id: 'trace-existing',
            preview_json: existingPreview,
          }),
          create: jest.fn(),
        },
      };
      const deps = {
        prisma: {
          $transaction: jest.fn(
            async (work: (client: typeof tx) => Promise<unknown>) => work(tx),
          ),
        },
        agentActionLog: {
          record: jest.fn(),
          recordInTransaction: jest.fn(),
        },
        tenantContext: { getTenantId: jest.fn().mockResolvedValue('tenant-1') },
        commandIdempotency: { completeInTransaction: jest.fn() },
      } as never;
      const call: McpWriteCall = {
        execution: {
          toolName: 'propose_customer_create',
          policyActionType: 'customer.create',
          buildPolicyContext: () => ({}),
          execute: async () => ({}),
          buildResultSummary: () => ({}),
          maskProposalPayload: (payload: unknown) => payload,
        },
        input: {
          action: 'customer.create',
          idempotency_key: 'aut613-create-1',
          fields: { email: 'max@example.at' },
        },
        context: { agentId: 'agent-1', onBehalfOfUserId: 'user-1' },
        actionType: 'customer.create',
        inputSummary: { tool: 'propose_customer_create', args: {} },
        tier: AgentPolicyTier.PROPOSE,
        reasons: ['policy'],
      };

      const result = await proposeMcpWriteViaPersist(
        deps,
        call,
        { preview: {}, wouldChange: [] },
        {
          proposalActionType: 'customer.create',
          proposalPayload: call.input,
          proposalPreview: {},
        },
      );

      expect(tx.agentProposal.create).not.toHaveBeenCalled();
      expect(result.pending_action_id).toBe('proposal-existing');
      expect(result.replayed).toBe(true);
      expect(result.status).toBe('needs_approval');
    });
  });
});
