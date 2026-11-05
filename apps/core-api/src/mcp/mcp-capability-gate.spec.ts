import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AuthSessionService } from '../auth/auth-session.service.js';
import type { CountryCapabilities } from '../common/country-pack/country-pack.registry.js';
import {
  CapabilityGuard,
  EffectiveCapabilitiesService,
  RequireCapability,
} from '../common/country-pack/effective-capabilities.guard.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { NovaCalculationService } from '../vehicle/nova-calculation.service.js';
import type { VehicleService } from '../vehicle/vehicle.service.js';
import { McpCapabilityGateService } from './mcp-capability-gate.service.js';
import { installCapabilityToolFilter } from './mcp-capability-tool-filter.js';
import { McpReportReadService } from './mcp-report-read.service.js';
import { createMcpServerWithWave2Reads } from './mcp-server.factory.wave2.js';
import type { McpToolHandlerWave2Wrapper } from './mcp-tool-handler.wave2-wrapper.js';

const VEHICLE_ID = '00000000-0000-4000-8000-0000000000c1';

type Capabilities = Partial<CountryCapabilities> | null;

const GATED_TOOLS = [
  ['list_pickerl_due', 'pickerl57a', {}],
  [
    'get_nova_preview',
    'nova',
    { vehicle_id: VEHICLE_ID, net_price_eur: '12000.00' },
  ],
] as const;

function buildHarness(effectiveCapabilities: Capabilities) {
  const sessions = {
    getSessionForAuthenticatedUser: jest
      .fn()
      .mockResolvedValue({ effectiveCapabilities }),
  };
  const tenantContext = {
    getAuthenticatedUser: () => ({ userId: 'user-1', tenantId: 'tenant-1' }),
  };
  const capabilities = new EffectiveCapabilitiesService(
    sessions as unknown as AuthSessionService,
    tenantContext as unknown as TenantContextService,
  );
  const vehicles = { getPickerlDueData: jest.fn().mockResolvedValue([]) };
  const nova = {
    calculate: jest.fn().mockResolvedValue({
      novaAmountEuro: 900,
      tariffVersionId: 'tariff-2026-01',
      appliedRuleIds: [],
      warnings: [],
      ratePercentApplied: 16,
      effectiveCo2GramsPerKm: 0,
      hasUnverifiedRules: false,
      hasScopeLimitations: false,
    }),
  };
  const gate = new McpCapabilityGateService(capabilities);
  const reports = new McpReportReadService(
    {} as never,
    {} as never,
    vehicles as unknown as VehicleService,
    {} as never,
    nova as unknown as NovaCalculationService,
    gate,
  );
  return { capabilities, gate, reports, vehicles, nova };
}

/** A real MCP server and client over an in-memory pair, routed to the real report reads. */
async function connectClient(harness: ReturnType<typeof buildHarness>) {
  const toolHandler = {
    executeTool: (name: string, args: Record<string, unknown>) =>
      name === 'list_pickerl_due'
        ? harness.reports.listPickerlDue(args)
        : harness.reports.getNovaPreview(args as never),
  } as unknown as McpToolHandlerWave2Wrapper;
  const server = createMcpServerWithWave2Reads(toolHandler, {
    agentId: 'agent',
    onBehalfOfUserId: 'user-1',
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  installCapabilityToolFilter(serverTransport, harness.gate);
  const client = new Client({ name: 'spec', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

async function listedToolNames(client: Client): Promise<string[]> {
  return (await client.listTools()).tools.map((tool) => tool.name);
}

describe('MCP capability gate (AUT-913)', () => {
  // Regression: the MCP tools kept answering after the tenant switched the capability off.
  describe.each(GATED_TOOLS)('%s', (tool, capability, args) => {
    it(`is listed and answers when ${capability} is on`, async () => {
      const harness = buildHarness({ [capability]: true });
      const client = await connectClient(harness);

      expect(await listedToolNames(client)).toContain(tool);
      const result = await client.callTool({ name: tool, arguments: args });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toBeDefined();
    });

    it.each([
      ['off', { [capability]: false }],
      ['null (not configured)', null],
    ])(
      `is hidden and refused with CAPABILITY_UNAVAILABLE when ${capability} is %s`,
      async (_label, capabilities) => {
        const harness = buildHarness(capabilities);
        const client = await connectClient(harness);

        expect(await listedToolNames(client)).not.toContain(tool);
        const result = await client.callTool({ name: tool, arguments: args });

        expect(result.isError).toBe(true);
        expect(JSON.stringify(result.content)).toContain(
          'CAPABILITY_UNAVAILABLE',
        );
        expect(harness.vehicles.getPickerlDueData).not.toHaveBeenCalled();
        expect(harness.nova.calculate).not.toHaveBeenCalled();
      },
    );
  });

  it('keeps the tools that no capability gates in the list when both capabilities are off', async () => {
    const client = await connectClient(
      buildHarness({ pickerl57a: false, nova: false }),
    );

    const names = await listedToolNames(client);

    expect(names).toContain('get_revenue_report');
    expect(names).not.toContain('list_pickerl_due');
    expect(names).not.toContain('get_nova_preview');
  });

  // Regression: MCP must refuse exactly where the REST CapabilityGuard refuses, including null.
  it.each([
    ['on', { pickerl57a: true }, false],
    ['off', { pickerl57a: false }, true],
    ['null', null, true],
  ])(
    'refuses like the REST guard when pickerl57a is %s',
    async (_label, capabilities, refused) => {
      const { capabilities: effective, gate } = buildHarness(capabilities);
      class RestProbe {
        @RequireCapability('pickerl57a')
        handler(): void {}
      }
      const context = {
        getHandler: () => RestProbe.prototype.handler,
        getClass: () => RestProbe,
        switchToHttp: () => ({ getRequest: () => ({ query: {} }) }),
      } as unknown as ExecutionContext;
      const restGuard = new CapabilityGuard(new Reflector(), effective);

      const rest = await restGuard
        .canActivate(context)
        .catch((e: unknown) => e);
      const mcp = await gate
        .assertAvailable('pickerl57a')
        .catch((e: unknown) => e);

      expect(rest === true).toBe(!refused);
      expect(mcp === undefined).toBe(!refused);
      if (refused) {
        expect(mcp).toBeInstanceOf(ForbiddenException);
        expect((mcp as ForbiddenException).getStatus()).toBe(
          (rest as ForbiddenException).getStatus(),
        );
        expect((mcp as ForbiddenException).getResponse()).toMatchObject({
          code: ((rest as ForbiddenException).getResponse() as { code: string })
            .code,
        });
      }
    },
  );
});
