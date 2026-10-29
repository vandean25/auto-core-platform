import { z } from 'zod';
import { mcpToolOutputSchemas } from './mcp-tool-output-schemas.js';

const legacyIds = [
  { source_system: 'legacy_system:company_a', external_id: '00123' },
  { source_system: 'legacy_system:company_b', external_id: '00123' },
];
const customer = {
  id: 'customer-1', tenant_id: 'tenant-1', type: 'PRIVATE',
  first_name: 'Mira', last_name: 'Example', company_name: null,
  email: null, phone: null, vat_id: null, contact_email_ok: false,
  address_street: null, address_city: null, address_zip: null, address_country: 'AT',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  legacy_ids: legacyIds,
};

describe('Legacy numbers in MCP read outputs', () => {
  it('keeps each source number in customer search results', () => {
    const result = mcpToolOutputSchemas.search_customers.parse({
      data: [customer], meta: { total: 1, page: 1, page_size: 10 },
    });
    expect(result.data?.[0]).toHaveProperty('legacy_ids', legacyIds);
  });

  it('keeps each source number in the compact customer detail', () => {
    const result = mcpToolOutputSchemas.get_customer.parse({
      ...customer, vehicles: [],
      orders: { data: [], meta: { page_size: 10, next_cursor: null }, truncated: false },
    });
    expect(result).toHaveProperty('legacy_ids', legacyIds);
  });

  it('publishes the vehicle search legacy number shape', () => {
    expect(z.toJSONSchema(mcpToolOutputSchemas.search_vehicles)).toHaveProperty(
      'properties.data.items.properties.legacy_ids.items.properties.external_id',
    );
  });

  it('publishes the vehicle detail legacy number shape', () => {
    expect(z.toJSONSchema(mcpToolOutputSchemas.get_vehicle)).toHaveProperty(
      'properties.legacy_ids.items.properties.source_system',
    );
  });
});
