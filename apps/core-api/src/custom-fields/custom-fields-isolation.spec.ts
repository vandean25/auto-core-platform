import { McpOrderHistoryReadService } from '../mcp/mcp-order-history-read.service.js';
import { renderEstimateSentEmail } from '../notifications/templates/customer-email-templates.js';

describe('Custom fields secondary-use isolation (Anti-criterion 3)', () => {
  it('excludes custom_fields from MCP get_customer output even when customer detail has custom_fields', async () => {
    const customerService = {
      findOne: jest.fn().mockResolvedValue({
        id: 'cust-1',
        tenant_id: 'tenant-1',
        type: 'PRIVATE',
        company_name: null,
        first_name: 'Max',
        last_name: 'Mustermann',
        email: 'max@example.com',
        phone: '+43123456',
        vat_id: null,
        address_street: null,
        address_city: 'Wien',
        address_zip: '1010',
        address_country: 'AT',
        createdAt: new Date(),
        updatedAt: new Date(),
        legacy_ids: [],
        vehicles: [],
        custom_fields: { flottennummer: 'FL-SECRET-1' },
      }),
    };
    const prisma = {
      workshopOrder: { findMany: jest.fn().mockResolvedValue([]) },
      salesOrder: { findMany: jest.fn().mockResolvedValue([]) },
      workshopEstimate: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const tenantContext = {
      getTenantId: jest.fn().mockResolvedValue('tenant-1'),
    };
    const siteContext = {
      getSiteId: jest.fn().mockResolvedValue('site-1'),
    };
    const pickerlBarriers = {
      loadBarrierFlags: jest.fn().mockResolvedValue({}),
    };
    const documentReads = {
      listDocuments: jest.fn().mockResolvedValue({ data: [], meta: {} }),
    };

    const service = new McpOrderHistoryReadService(
      prisma as never,
      siteContext as never,
      tenantContext as never,
      pickerlBarriers as never,
      customerService as never,
      documentReads as never,
    );

    const result = await service.getCustomer({ customer_id: 'cust-1' });
    expect(result).not.toHaveProperty('custom_fields');
    expect(JSON.stringify(result)).not.toContain('FL-SECRET-1');
  });

  it('does not include custom_fields in notification outbox email drafts', () => {
    const draft = renderEstimateSentEmail({
      recipientEmail: 'max@example.com',
      senderName: 'Werkstatt Wien',
      estimateNumber: 'KVA-2026-001',
      vehicleLabel: 'VW Golf',
      approvalUrl: 'https://app.example.com/approve/token',
      validUntil: new Date('2026-12-31T12:00:00.000Z'),
    });

    expect(draft).not.toHaveProperty('custom_fields');
    expect(JSON.stringify(draft)).not.toContain('custom_fields');
  });
});
