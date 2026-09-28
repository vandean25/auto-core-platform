import { resolveInvoiceSnapshot } from './invoice-snapshot.resolver.js';

const branding = {
  schema_version: 1,
  profile_id: null,
  profile_revision: 0,
  preset_id: 'standard-v1',
  renderer_version: 'invoice-brand-v1',
  font_id: 'acp-sans-v1',
  tokens: {
    primary_color: '#111827',
    secondary_color: '#E5E7EB',
    header_band: 'none',
    footer_band: 'none',
    header_text: '',
    footer_text: '',
  },
  logo: null,
  resolved_at: '2026-09-28T12:00:00.000Z',
} as const;

const snapshot = {
  id: 'invoice-1',
  invoice_number: 'RE-2026-0001',
  date: '2026-09-28T00:00:00.000Z',
  due_date: '2026-10-12T00:00:00.000Z',
  total_net: '100.00',
  total_tax: '20.00',
  total_gross: '120.00',
  notes: null,
  tax_mode: 'STANDARD',
  customer: {
    type: 'PRIVATE',
    company_name: null,
    first_name: 'Max',
    last_name: 'Mustermann',
    email: null,
    phone: null,
    vat_id: null,
    address_street: null,
    address_city: null,
    address_zip: null,
    address_country: null,
  },
  vehicle: null,
  items: [
    {
      description: 'Service',
      quantity: '1.000',
      unit_price: '100.00',
      tax_rate: '20.00',
      line_discount_type: null,
      line_discount_value: null,
      line_total: '120.00',
      revenue_group_name: null,
    },
  ],
  snapshot_created_at: '2026-09-28T12:00:00.000Z',
  schema_version: 2,
  template_version: 'invoice-brand-v1',
  document_kind: 'INVOICE',
  site_id: 'site-1',
  legal_entity_id: 'entity-1',
  currency: 'EUR',
  seller: { name: 'Example GmbH' },
  supply_date_from: '2026-09-28',
  supply_date_to: '2026-09-28',
  payment_terms: { days: 14, text: '14 days' },
  tax_breakdown: [],
  branding,
};

describe('resolveInvoiceSnapshot branded snapshots', () => {
  const prisma = {
    client: { invoice: { findFirst: jest.fn() } },
  };

  beforeEach(() => jest.clearAllMocks());

  it('preserves branding and the template version for rendering', async () => {
    const resolved = await resolveInvoiceSnapshot(
      prisma as never,
      'invoice-1',
      snapshot,
      'tenant-1',
    );

    expect(resolved.template_version).toBe('invoice-brand-v1');
    expect(resolved.branding).toEqual(branding);
    expect(prisma.client.invoice.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a corrupt branded snapshot without falling back to a legacy renderer', async () => {
    await expect(
      resolveInvoiceSnapshot(
        prisma as never,
        'invoice-1',
        { ...snapshot, branding: undefined },
        'tenant-1',
      ),
    ).rejects.toMatchObject({
      response: { code: 'BRAND_RENDER_INPUT_UNAVAILABLE' },
    });
    expect(prisma.client.invoice.findFirst).not.toHaveBeenCalled();
  });

  it('keeps historical V2 snapshots on their existing path', async () => {
    const { branding: _branding, ...historicalV2 } = snapshot;
    const historical = {
      ...historicalV2,
      template_version: 'invoice-pdf-v1',
    };
    const resolved = await resolveInvoiceSnapshot(
      prisma as never,
      'invoice-1',
      historical,
      'tenant-1',
    );

    expect(resolved).toEqual(historical);
    expect(resolved.branding).toBeUndefined();
  });
});
