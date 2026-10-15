import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AgentPolicyTier, McpWriteCommandReceiptStatus } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import {
  MCP_COMMAND_IDEMPOTENCY_CONFLICT,
  MCP_COMMAND_IN_FLIGHT_LEASE_MS,
  McpWriteCommandIdempotencyService,
} from './mcp-write-command-idempotency.service.js';

const baseReceipt = {
  id: 'receipt-1',
  tenant_id: 'tenant-1',
  command_id: '51500000-0000-4000-8000-000000000001',
  on_behalf_of_user_id: 'user-1',
  agent_id: 'mcp:agent-a',
  site_id: 'site-1',
  tool_name: 'draft_workshop_order',
  args_fingerprint: 'fp-1',
  status: McpWriteCommandReceiptStatus.COMPLETED,
  original_trace_id: '00000000-0000-4000-8000-000000000099',
  response_json: {
    tool: 'draft_workshop_order',
    tier: 'AUTO',
    status: 'executed',
    would_change: [],
    result: { id: 'order-1' },
    trace_id: '00000000-0000-4000-8000-000000000099',
  },
  updated_at: new Date(),
};

describe('McpWriteCommandIdempotencyService', () => {
  let service: McpWriteCommandIdempotencyService;
  let prisma: {
    mcpWriteCommandReceipt: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    agentProposal: { findFirst: jest.Mock };
  };
  let siteContext: { resolveSiteId: jest.Mock; listAuthorizedSiteIds: jest.Mock };
  let tenantContext: { getTenantId: jest.Mock };

  const context = { agentId: 'mcp:other-session', onBehalfOfUserId: 'user-1' };

  beforeEach(async () => {
    prisma = {
      mcpWriteCommandReceipt: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      agentProposal: { findFirst: jest.fn() },
    };
    siteContext = {
      resolveSiteId: jest.fn().mockResolvedValue('site-1'),
      listAuthorizedSiteIds: jest.fn().mockResolvedValue(['site-1']),
    };
    tenantContext = { getTenantId: jest.fn().mockResolvedValue('tenant-1') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        McpWriteCommandIdempotencyService,
        { provide: PrismaService, useValue: prisma },
        { provide: SiteContextService, useValue: siteContext },
        { provide: TenantContextService, useValue: tenantContext },
      ],
    }).compile();

    service = module.get(McpWriteCommandIdempotencyService);
  });

  it('replays a completed receipt for another MCP agent session on the same on-behalf user', async () => {
    prisma.mcpWriteCommandReceipt.findFirst.mockResolvedValue(baseReceipt);

    const gate = await service.beginOrReplay({
      commandId: baseReceipt.command_id,
      toolName: 'draft_workshop_order',
      argsFingerprint: 'fp-1',
      context,
      originalTraceId: '00000000-0000-4000-8000-000000000100',
    });

    expect(gate.kind).toBe('replay');
    if (gate.kind === 'replay') {
      expect(gate.result.replayed).toBe(true);
      expect(gate.result.trace_id).toBe(baseReceipt.original_trace_id);
      expect(gate.result.result).toEqual({ id: 'order-1' });
    }
  });

  it('returns MCP_COMMAND_IDEMPOTENCY_CONFLICT when the active site differs', async () => {
    prisma.mcpWriteCommandReceipt.findFirst.mockResolvedValue(baseReceipt);
    siteContext.resolveSiteId.mockResolvedValue('site-2');

    await expect(
      service.beginOrReplay({
        commandId: baseReceipt.command_id,
        toolName: 'draft_workshop_order',
        argsFingerprint: 'fp-1',
        context,
        originalTraceId: 'trace-new',
      }),
    ).rejects.toMatchObject({
      response: { code: MCP_COMMAND_IDEMPOTENCY_CONFLICT },
    });
  });

  it('forbids replay when the caller lost membership on the stored site', async () => {
    prisma.mcpWriteCommandReceipt.findFirst.mockResolvedValue(baseReceipt);
    siteContext.listAuthorizedSiteIds.mockResolvedValue([]);

    await expect(
      service.beginOrReplay({
        commandId: baseReceipt.command_id,
        toolName: 'draft_workshop_order',
        argsFingerprint: 'fp-1',
        context,
        originalTraceId: 'trace-new',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('reclaims a stale IN_FLIGHT receipt for execution', async () => {
    const stale = {
      ...baseReceipt,
      status: McpWriteCommandReceiptStatus.IN_FLIGHT,
      response_json: null,
      updated_at: new Date(Date.now() - MCP_COMMAND_IN_FLIGHT_LEASE_MS - 1_000),
    };
    prisma.mcpWriteCommandReceipt.findFirst.mockResolvedValue(stale);
    prisma.agentProposal.findFirst.mockResolvedValue(null);
    prisma.mcpWriteCommandReceipt.updateMany.mockResolvedValue({ count: 1 });

    const gate = await service.beginOrReplay({
      commandId: stale.command_id,
      toolName: 'draft_workshop_order',
      argsFingerprint: 'fp-1',
      context,
      originalTraceId: 'trace-new',
    });

    expect(gate).toEqual({
      kind: 'execute',
      claim: {
        receiptId: stale.id,
        originalTraceId: stale.original_trace_id,
      },
    });
  });

  it('lets only one concurrent reclaim win', async () => {
    prisma.mcpWriteCommandReceipt.updateMany.mockResolvedValueOnce({
      count: 1,
    });
    prisma.mcpWriteCommandReceipt.updateMany.mockResolvedValueOnce({
      count: 0,
    });

    expect(
      await service.tryReclaimStaleInFlight('receipt-1', 'tenant-1'),
    ).toBe(true);
    expect(
      await service.tryReclaimStaleInFlight('receipt-1', 'tenant-1'),
    ).toBe(false);
  });

  it('does not replay from another tenant', async () => {
    prisma.mcpWriteCommandReceipt.findFirst.mockResolvedValue(null);
    prisma.mcpWriteCommandReceipt.create.mockResolvedValue({
      id: 'new-receipt',
      original_trace_id: 'trace-new',
    });

    await service.beginOrReplay({
      commandId: '51500000-0000-4000-8000-000000000002',
      toolName: 'draft_workshop_order',
      argsFingerprint: 'fp-1',
      context,
      originalTraceId: 'trace-new',
    });

    expect(prisma.mcpWriteCommandReceipt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenant_id: 'tenant-1' }),
      }),
    );
  });

  it('completes a pending proposal into the receipt without using action logs', async () => {
    const inFlight = {
      ...baseReceipt,
      status: McpWriteCommandReceiptStatus.IN_FLIGHT,
      response_json: null,
      tool_name: 'propose_line_item',
      updated_at: new Date(),
    };
    prisma.mcpWriteCommandReceipt.findFirst.mockResolvedValue(inFlight);
    prisma.agentProposal.findFirst.mockResolvedValue({
      id: 'proposal-9',
      tier: AgentPolicyTier.PROPOSE,
      payload_json: { line: 1 },
      preview_json: {
        would_change: [],
        preview: { id: 'preview' },
      },
    });
    prisma.mcpWriteCommandReceipt.update.mockResolvedValue(inFlight);

    const gate = await service.beginOrReplay({
      commandId: inFlight.command_id,
      toolName: 'propose_line_item',
      argsFingerprint: 'fp-1',
      context,
      originalTraceId: inFlight.original_trace_id,
    });

    expect(gate.kind).toBe('replay');
    expect(prisma.agentProposal.findFirst).toHaveBeenCalled();
    expect(prisma.mcpWriteCommandReceipt.update).toHaveBeenCalled();
  });

  it('throws MCP_COMMAND_IN_FLIGHT for a fresh IN_FLIGHT row', async () => {
    const inFlight = {
      ...baseReceipt,
      status: McpWriteCommandReceiptStatus.IN_FLIGHT,
      response_json: null,
      updated_at: new Date(),
    };
    prisma.mcpWriteCommandReceipt.findFirst.mockResolvedValue(inFlight);
    prisma.agentProposal.findFirst.mockResolvedValue(null);
    prisma.mcpWriteCommandReceipt.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.beginOrReplay({
        commandId: inFlight.command_id,
        toolName: 'draft_workshop_order',
        argsFingerprint: 'fp-1',
        context,
        originalTraceId: 'trace-new',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
