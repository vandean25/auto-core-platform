import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AuthSessionService } from '../auth/auth-session.service.js';
import type { CountryCapabilities } from '../common/country-pack/country-pack.registry.js';
import { EffectiveCapabilitiesService } from '../common/country-pack/effective-capabilities.guard.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { NovaCalculationService } from '../vehicle/nova-calculation.service.js';
import type { VehicleService } from '../vehicle/vehicle.service.js';
import { McpCapabilityGateService } from './mcp-capability-gate.service.js';
import { installCapabilityToolFilter } from './mcp-capability-tool-filter.js';
import { McpReportReadService } from './mcp-report-read.service.js';
import { createMcpServerWithWave2Reads } from './mcp-server.factory.wave2.js';
import type { McpToolHandlerWave2Wrapper } from './mcp-tool-handler.wave2-wrapper.js';

const VEHICLE_ID = '00000000-0000-4000-8000-0000000000c1';

export type Capabilities = Partial<CountryCapabilities> | null;

export const GATED_TOOLS = [
  ['list_pickerl_due', 'pickerl57a', {}],
  [
    'get_nova_preview',
    'nova',
    { vehicle_id: VEHICLE_ID, net_price_eur: '12000.00' },
  ],
] as const;

export function buildHarness(effectiveCapabilities: Capabilities) {
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
export async function connectClient(harness: ReturnType<typeof buildHarness>) {
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

export async function listedToolNames(client: Client): Promise<string[]> {
  return (await client.listTools()).tools.map((tool) => tool.name);
}
