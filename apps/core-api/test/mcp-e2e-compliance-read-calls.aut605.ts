import type { McpComplianceReadToolName } from '../src/mcp/mcp-read-tool-catalog.aut605.js';

type ComplianceReadCall = {
  name: McpComplianceReadToolName;
  arguments: Record<string, unknown>;
};

/** AUT-605 read tool calls for MCP e2e (kept out of the main e2e spec body). */
export function complianceReadCallsForE2e(fixtures: {
  customerId: string;
  workshopOrderId: string;
}): ComplianceReadCall[] {
  return [
    {
      name: 'check_contact_permission',
      arguments: {
        customer_id: fixtures.customerId,
        purpose: 'ORDER_COMMUNICATION',
        channel: 'EMAIL',
      },
    },
    { name: 'list_gewaehrleistung_due', arguments: {} },
    { name: 'list_tyre_sets', arguments: {} },
    {
      name: 'list_warranty_claims',
      arguments: { order_id: fixtures.workshopOrderId },
    },
  ];
}
