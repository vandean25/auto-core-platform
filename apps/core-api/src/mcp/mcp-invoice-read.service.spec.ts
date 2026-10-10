import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import { toRenderableInvoiceSnapshot } from '../invoices/invoice-snapshot-render.adapter.js';
import type { SiteContextService } from '../common/services/site-context.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { McpInvoiceReadService } from './mcp-invoice-read.service.js';
import {
  decodeMcpKeysetCursor,
  encodeMcpKeysetCursor,
} from './mcp-output.util.js';

const TENANT_A = '00000000-0000-4000-8000-00000000000a';
const TENANT_B = '00000000-0000-4000-8000-00000000000b';
const SITE_A = '00000000-0000-4000-8000-0000000000a1';
const SITE_B = '00000000-0000-4000-8000-0000000000b1';
const INVOICE_ID = '00000000-0000-4000-8000-0000000000f1';
const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c1';
const WORKSHOP_ORDER_ID = '00000000-0000-4000-8000-0000000000d1';
const SALES_ORDER_ID = '00000000-0000-4000-8000-0000000000d2';
const OTHER_INVOICE_ID = '00000000-0000-4000-8000-0000000000f2';
const CREDIT_NOTE_ID = '00000000-0000-4000-8000-0000000000e1';

/** Committed V2 snapshot: the same frozen data the PDF renders. Totals equal the line sums. */
const SNAPSHOT_V2 = {
  schema_version: 2,
  document_kind: 'INVOICE',
  template_version: 'invoice-pdf-v1',
  country_profile_version: 'legal-invoicing-v1',
  site_id: SITE_A,
  legal_entity_id: '00000000-0000-4000-8000-0000000000l1',
  currency: 'EUR',
  seller: {
    name: 'Musterwerkstatt Nord GmbH',
    country_iso: 'AT',
    address_street: 'Testgasse 1',
    address_line2: 'Hof 2',
    address_zip: '1010',
    address_city: 'Wien',
    tax_number: '12 345/6789',
    vat_id: 'ATU00000000',
    iban: 'AT00 0000 0000 0000 0000',
    bic: 'TESTATWW',
    bank_name: 'Testbank',
    email: 'office@example.invalid',
    phone: '+43 1 000000',
    registration_number: 'FN 000000 x',
    registration_court: 'Handelsgericht Wien',
    representatives: 'Erika Beispiel',
  },
  customer: {
    type: 'PRIVATE',
    company_name: null,
    first_name: 'Erika',
    last_name: 'Beispiel',
    email: 'erika@example.invalid',
    phone: '+43 660 000000',
    vat_id: null,
    address_street: 'Kundenstraße 2',
    address_city: 'Graz',
    address_zip: '8010',
    address_country: 'AT',
  },
  vehicle: null,
  date: '2026-09-20',
  due_date: '2026-10-04',
  supply_date_from: '2026-09-20',
  supply_date_to: '2026-09-20',
  payment_terms: { days: 14, text: 'Zahlbar innerhalb von 14 Tagen.' },
  items: [
    {
      id: 'line-1',
      description: 'Ölwechsel',
      quantity: '1.000',
      unit_price: '100.00',
      tax_rate: '20.00',
      line_discount_type: null,
      line_discount_value: null,
      net: '100.00',
      tax: '20.00',
      gross: '120.00',
      revenue_group_name: 'Service',
      accounting_allocation: {
        profileCode: 'ACP-DATEV-AT-EUR-1',
        profileVersion: 1,
        sourceCategoryKey: 'manual_line',
        sourceCategoryLabel: 'Manual invoice lines',
        revenueAccount: '8400',
        debtorAccount: '1000',
        taxMode: 'STANDARD',
        taxRate: '20.00',
        taxTreatment: 'automatic',
        buKey: null,
        countryIso: 'AT',
        currency: 'EUR',
      },
    },
    {
      id: 'line-2',
      description: 'Filter',
      quantity: '2.000',
      unit_price: '25.00',
      tax_rate: '20.00',
      line_discount_type: 'PERCENTAGE',
      line_discount_value: '10.00',
      net: '45.00',
      tax: '9.00',
      gross: '54.00',
      revenue_group_name: 'Parts',
      accounting_allocation: {
        profileCode: 'ACP-DATEV-AT-EUR-1',
        profileVersion: 1,
        sourceCategoryKey: 'manual_line',
        sourceCategoryLabel: 'Manual invoice lines',
        revenueAccount: '8400',
        debtorAccount: '1000',
        taxMode: 'STANDARD',
        taxRate: '20.00',
        taxTreatment: 'automatic',
        buKey: null,
        countryIso: 'AT',
        currency: 'EUR',
      },
    },
  ],
  tax_breakdown: [{ rate: '20.00', net: '145.00', tax: '29.00', gross: '174.00' }],
  total_net: '145.00',
  total_tax: '29.00',
  total_gross: '174.00',
  notes: 'Vielen Dank.',
  tax_mode: 'STANDARD',
  snapshot_created_at: '2026-09-20T12:00:00.000Z',
};

type ListRecord = ReturnType<typeof listRecord>;

function listRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: INVOICE_ID,
    invoice_number: 'RE-2026-0001',
    status: InvoiceStatus.FINALIZED as InvoiceStatus,
    date: new Date('2026-09-20T00:00:00.000Z'),
    currency: 'EUR',
    total_gross: new Prisma.Decimal('174.00'),
    customer: {
      id: CUSTOMER_ID,
      type: 'PRIVATE' as const,
      company_name: null,
      first_name: 'Erika',
      last_name: 'Beispiel',
    },
    ...overrides,
  };
}

function detailRecord(overrides: Record<string, unknown> = {}) {
  return {
    ...listRecord(),
    tax_mode: 'STANDARD' as const,
    due_date: new Date('2026-10-04T00:00:00.000Z'),
    total_net: new Prisma.Decimal('145.00'),
    total_tax: new Prisma.Decimal('29.00'),
    total_gross: new Prisma.Decimal('174.00'),
    global_discount_type: null,
    snapshot: SNAPSHOT_V2 as unknown,
    workshop_order_id: null as string | null,
    sales_order_id: null as string | null,
    items: [] as Array<Record<string, unknown>>,
    credit_notes: [] as Array<Record<string, unknown>>,
    ...overrides,
  };
}

function build(
  options: {
    tenantId?: string;
    siteId?: string;
    store?: Array<Record<string, unknown>>;
  } = {},
) {
  const store = options.store ?? [];
  const prisma = {
    invoice: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(
        async ({ where }: { where: Record<string, unknown> }) =>
          store.find((row) =>
            Object.entries(where).every(([key, value]) => row[key] === value),
          ) ?? null,
      ),
    },
    workshopOrder: { findFirst: jest.fn().mockResolvedValue(null) },
    salesOrder: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const tenantContext = {
    getTenantId: jest.fn().mockResolvedValue(options.tenantId ?? TENANT_A),
  };
  const siteContext = {
    getSiteId: jest.fn().mockResolvedValue(options.siteId ?? SITE_A),
  };
  const service = new McpInvoiceReadService(
    prisma as unknown as PrismaService,
    siteContext as unknown as SiteContextService,
    tenantContext as unknown as TenantContextService,
  );
  return { service, prisma, tenantContext, siteContext };
}

describe('McpInvoiceReadService.listInvoices', () => {
  it('scopes every query to the tenant from the session and the active site', async () => {
    const { service, prisma, tenantContext, siteContext } = build();

    await service.listInvoices({});

    expect(tenantContext.getTenantId).toHaveBeenCalled();
    expect(siteContext.getSiteId).toHaveBeenCalled();
    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenant_id: TENANT_A, site_id: SITE_A },
      }),
    );
  });

  it('filters by status, customer, and invoice number', async () => {
    const { service, prisma } = build();

    await service.listInvoices({
      status: 'PAID',
      customer_id: CUSTOMER_ID,
      number: '2026-0001',
    });

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenant_id: TENANT_A,
          site_id: SITE_A,
          status: 'PAID',
          customer_id: CUSTOMER_ID,
          invoice_number: { contains: '2026-0001', mode: 'insensitive' },
        }),
      }),
    );
  });

  it('matches an order ID against both workshop and sales order links', async () => {
    const { service, prisma } = build();

    await service.listInvoices({ order_id: WORKSHOP_ORDER_ID });

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { workshop_order_id: WORKSHOP_ORDER_ID },
            { sales_order_id: WORKSHOP_ORDER_ID },
          ],
        }),
      }),
    );
  });

  it('includes both ends of an issue-date range by UTC day', async () => {
    const { service, prisma } = build();

    await service.listInvoices({ from: '2026-09-01', to: '2026-09-30' });

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          date: {
            gte: new Date('2026-09-01T00:00:00.000Z'),
            lte: new Date('2026-09-30T23:59:59.999Z'),
          },
        }),
      }),
    );
  });

  it('applies a single-sided issue-date bound', async () => {
    const { service, prisma } = build();

    await service.listInvoices({ from: '2026-09-15' });

    const where = prisma.invoice.findMany.mock.calls[0][0].where;
    expect(where.date).toEqual({
      gte: new Date('2026-09-15T00:00:00.000Z'),
    });
  });

  it('orders newest first by issue date with the ID as a tiebreaker', async () => {
    const { service, prisma } = build();

    await service.listInvoices({});

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('defaults to 10 rows and reads one extra row to detect a next page', async () => {
    const { service, prisma } = build();

    await service.listInvoices({});

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 11 }),
    );
  });

  it('returns a cursor at the last returned row when another page exists', async () => {
    const { service, prisma } = build();
    const rows = Array.from({ length: 11 }, (_, index) =>
      listRecord({
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        date: new Date(Date.UTC(2026, 8, 30 - index)),
      }),
    );
    prisma.invoice.findMany.mockResolvedValue(rows);

    const page = await service.listInvoices({ pageSize: 10 });

    expect(page.data).toHaveLength(10);
    expect(page.meta.page_size).toBe(10);
    expect(page.truncated).toBe(false);
    const cursor = decodeMcpKeysetCursor(page.meta.next_cursor as string);
    expect(cursor).toEqual({
      at: rows[9].date.toISOString(),
      id: rows[9].id,
    });
  });

  it('returns no cursor on the last page', async () => {
    const { service, prisma } = build();
    prisma.invoice.findMany.mockResolvedValue([
      listRecord(),
      listRecord({ id: OTHER_INVOICE_ID }),
    ]);

    const page = await service.listInvoices({ pageSize: 25 });

    expect(page.meta).toEqual({ page_size: 25, next_cursor: null });
    expect(page.truncated).toBe(false);
  });

  it('resumes strictly after the cursor position, newest first', async () => {
    const { service, prisma } = build();
    const at = '2026-09-20T00:00:00.000Z';
    const cursor = encodeMcpKeysetCursor({ at, id: INVOICE_ID });

    await service.listInvoices({ cursor });

    const where = prisma.invoice.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual([
      {
        OR: [
          { date: { lt: new Date(at) } },
          { date: new Date(at), id: { lt: INVOICE_ID } },
        ],
      },
    ]);
  });

  it('rejects a cursor that is not a keyset position', async () => {
    const { service, prisma } = build();

    await expect(
      service.listInvoices({ cursor: 'bm90LWEtY3Vyc29y' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
  });

  it('caps a page at the 32 KB result limit and points the cursor at the first dropped row', async () => {
    const { service, prisma } = build();
    const longName = 'N'.repeat(1500);
    const rows = Array.from({ length: 25 }, (_, index) =>
      listRecord({
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        customer: {
          id: CUSTOMER_ID,
          type: 'PRIVATE',
          company_name: null,
          first_name: 'Erika',
          last_name: longName,
        },
      }),
    );
    prisma.invoice.findMany.mockResolvedValue(rows);

    const page = await service.listInvoices({ pageSize: 25 });

    expect(page.truncated).toBe(true);
    expect(page.data.length).toBeLessThan(25);
    expect(JSON.stringify(page).length).toBeLessThanOrEqual(32_768);
    const cursor = decodeMcpKeysetCursor(page.meta.next_cursor as string);
    const lastKept = rows[page.data.length - 1];
    expect(cursor).toEqual({ at: lastKept.date.toISOString(), id: lastKept.id });
  });

  it('never returns customer contact data or the frozen snapshot', async () => {
    const { service, prisma } = build();
    prisma.invoice.findMany.mockResolvedValue([listRecord()]);

    const page = await service.listInvoices({});
    const serialized = JSON.stringify(page);

    expect(serialized).not.toMatch(/@|\+43|snapshot|internal_notes/);
    expect(page.data[0]).toEqual({
      id: INVOICE_ID,
      number: 'RE-2026-0001',
      status: 'FINALIZED',
      customer: { id: CUSTOMER_ID, name: 'Erika Beispiel' },
      issued_at: '2026-09-20T00:00:00.000Z',
      total_gross: '174.00',
      currency: 'EUR',
    });
  });
});

describe('McpInvoiceReadService.getInvoice', () => {
  it('reads the invoice by ID within the session tenant and active site', async () => {
    const { service, prisma } = build({
      store: [{ ...detailRecord(), tenant_id: TENANT_A, site_id: SITE_A }],
    });

    await service.getInvoice({ invoice_id: INVOICE_ID });

    expect(prisma.invoice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: INVOICE_ID, tenant_id: TENANT_A, site_id: SITE_A },
      }),
    );
  });

  it('does not reveal an invoice that belongs to another tenant or another site', async () => {
    const store = [
      { ...detailRecord(), id: 'other-tenant', tenant_id: TENANT_B, site_id: SITE_A },
      { ...detailRecord(), id: 'other-site', tenant_id: TENANT_A, site_id: SITE_B },
    ];
    const { service } = build({ store });

    await expect(
      service.getInvoice({ invoice_id: 'other-tenant' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.getInvoice({ invoice_id: 'other-site' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reports committed totals, lines, and seller exactly as the PDF renders them', async () => {
    const row = { ...detailRecord(), tenant_id: TENANT_A, site_id: SITE_A };
    const { service } = build({ store: [row] });

    const invoice = await service.getInvoice({ invoice_id: INVOICE_ID });

    const pdf = toRenderableInvoiceSnapshot(
      SNAPSHOT_V2,
      'RE-2026-0001',
      INVOICE_ID,
    );
    expect(pdf).not.toBeNull();
    expect(invoice.amount_source).toBe('snapshot');
    expect(invoice.totals).toEqual({
      net: pdf!.total_net,
      tax: pdf!.total_tax,
      gross: pdf!.total_gross,
    });
    expect(invoice.totals).toEqual({ net: '145.00', tax: '29.00', gross: '174.00' });
    expect(invoice.lines).toEqual(
      pdf!.items.map((item, index) => ({
        description: item.description,
        quantity: item.quantity,
        unit_net: item.unit_price,
        tax_rate: item.tax_rate,
        net: SNAPSHOT_V2.items[index].net,
        gross: item.line_total,
      })),
    );
    expect(invoice.seller).toEqual(pdf!.seller);
  });

  it('keeps a cancelled invoice readable from its committed snapshot', async () => {
    const row = {
      ...detailRecord({ status: InvoiceStatus.CANCELLED }),
      tenant_id: TENANT_A,
      site_id: SITE_A,
    };
    const { service } = build({ store: [row] });

    const invoice = await service.getInvoice({ invoice_id: INVOICE_ID });

    expect(invoice.status).toBe('CANCELLED');
    expect(invoice.amount_source).toBe('snapshot');
    expect(invoice.totals.gross).toBe('174.00');
  });

  it('reports a draft from its stored rows even when a snapshot is present', async () => {
    const row = {
      ...detailRecord({ status: InvoiceStatus.DRAFT }),
      tenant_id: TENANT_A,
      site_id: SITE_A,
    };
    const { service } = build({ store: [row] });

    const invoice = await service.getInvoice({ invoice_id: INVOICE_ID });

    expect(invoice.amount_source).toBe('stored');
    expect(invoice.seller).toBeNull();
  });

  it('reports a draft from its stored rows, with line amounts and no seller', async () => {
    const row = {
      ...detailRecord({
        status: InvoiceStatus.DRAFT,
        snapshot: null,
        total_net: new Prisma.Decimal('145.00'),
        total_tax: new Prisma.Decimal('29.00'),
        total_gross: new Prisma.Decimal('174.00'),
        items: [
          {
            description: 'Ölwechsel',
            quantity: new Prisma.Decimal('1'),
            unit_price: new Prisma.Decimal('100'),
            tax_rate: new Prisma.Decimal('20'),
            line_discount_type: null,
            line_discount_value: null,
          },
          {
            description: 'Filter',
            quantity: new Prisma.Decimal('2'),
            unit_price: new Prisma.Decimal('25'),
            tax_rate: new Prisma.Decimal('20'),
            line_discount_type: 'PERCENTAGE',
            line_discount_value: new Prisma.Decimal('10'),
          },
        ],
      }),
      tenant_id: TENANT_A,
      site_id: SITE_A,
    };
    const { service } = build({ store: [row] });

    const invoice = await service.getInvoice({ invoice_id: INVOICE_ID });

    expect(invoice.status).toBe('DRAFT');
    expect(invoice.amount_source).toBe('stored');
    expect(invoice.seller).toBeNull();
    expect(invoice.totals).toEqual({ net: '145.00', tax: '29.00', gross: '174.00' });
    expect(invoice.lines).toEqual([
      {
        description: 'Ölwechsel',
        quantity: '1.000',
        unit_net: '100.00',
        tax_rate: '20.00',
        net: '100.00',
        gross: '120.00',
      },
      {
        description: 'Filter',
        quantity: '2.000',
        unit_net: '25.00',
        tax_rate: '20.00',
        net: '45.00',
        gross: '54.00',
      },
    ]);
  });

  it('reports null line amounts for a draft with an invoice-level discount', async () => {
    const row = {
      ...detailRecord({
        status: InvoiceStatus.DRAFT,
        snapshot: null,
        global_discount_type: 'PERCENTAGE',
        items: [
          {
            description: 'Service',
            quantity: new Prisma.Decimal('1'),
            unit_price: new Prisma.Decimal('100'),
            tax_rate: new Prisma.Decimal('20'),
            line_discount_type: null,
            line_discount_value: null,
          },
        ],
      }),
      tenant_id: TENANT_A,
      site_id: SITE_A,
    };
    const { service } = build({ store: [row] });

    const invoice = await service.getInvoice({ invoice_id: INVOICE_ID });

    expect(invoice.lines[0]).toMatchObject({ net: null, gross: null });
  });

  it('reports a legacy V1 snapshot totals and leaves line amounts null', async () => {
    const legacySnapshot = {
      id: INVOICE_ID,
      invoice_number: 'RE-2025-0007',
      date: '2025-06-01T00:00:00.000Z',
      due_date: '2025-06-15T00:00:00.000Z',
      total_net: '100.00',
      total_tax: '20.00',
      total_gross: '120.00',
      notes: null,
      tax_mode: 'STANDARD',
      customer: {
        type: 'PRIVATE',
        company_name: null,
        first_name: 'Erika',
        last_name: 'Beispiel',
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
          quantity: '1.00',
          unit_price: '100.00',
          tax_rate: '20.00',
          line_discount_type: null,
          line_discount_value: null,
          line_total: '120.00',
          revenue_group_name: null,
        },
      ],
      snapshot_created_at: '2025-06-01T12:00:00.000Z',
    };
    const row = {
      ...detailRecord({
        status: InvoiceStatus.ISSUED,
        snapshot: legacySnapshot,
        total_net: new Prisma.Decimal('100.00'),
        total_tax: new Prisma.Decimal('20.00'),
        total_gross: new Prisma.Decimal('120.00'),
      }),
      tenant_id: TENANT_A,
      site_id: SITE_A,
    };
    const { service } = build({ store: [row] });

    const invoice = await service.getInvoice({ invoice_id: INVOICE_ID });

    expect(invoice.amount_source).toBe('snapshot');
    expect(invoice.totals).toEqual({ net: '100.00', tax: '20.00', gross: '120.00' });
    expect(invoice.seller).toBeNull();
    expect(invoice.lines).toEqual([
      {
        description: 'Service',
        quantity: '1.00',
        unit_net: '100.00',
        tax_rate: '20.00',
        net: null,
        gross: null,
      },
    ]);
  });

  it('keeps customer contact data, notes, and PDF storage keys out of the response', async () => {
    const row = {
      ...detailRecord({
        internal_notes: 'Nur intern',
        notes: 'Kundenhinweis',
        pdf_storage_key: 'invoices/secret-key.pdf',
      }),
      tenant_id: TENANT_A,
      site_id: SITE_A,
    };
    const { service } = build({ store: [row] });

    const invoice = await service.getInvoice({ invoice_id: INVOICE_ID });
    const serialized = JSON.stringify(invoice);

    expect(serialized).not.toMatch(/erika@example|\+43 660|Kundenstraße|Nur intern|secret-key|Kundenhinweis/);
    expect(serialized).not.toMatch(/"snapshot":|"pdf_|internal_notes/);
    expect(invoice.customer).toEqual({ id: CUSTOMER_ID, name: 'Erika Beispiel' });
  });

  it('lists credit notes of this invoice within the tenant and site, with their own number and status', async () => {
    const row = {
      ...detailRecord({
        credit_notes: [
          {
            id: CREDIT_NOTE_ID,
            credit_number: 'GS-2026-0001',
            status: 'FINALIZED',
            total_gross: new Prisma.Decimal('54.00'),
            finalized_at: new Date('2026-09-25T10:00:00.000Z'),
          },
        ],
      }),
      tenant_id: TENANT_A,
      site_id: SITE_A,
    };
    const { service, prisma } = build({ store: [row] });

    const invoice = await service.getInvoice({ invoice_id: INVOICE_ID });

    expect(prisma.invoice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          credit_notes: expect.objectContaining({
            where: { tenant_id: TENANT_A, site_id: SITE_A },
          }),
        }),
      }),
    );
    expect(invoice.credit_notes).toEqual([
      {
        id: CREDIT_NOTE_ID,
        number: 'GS-2026-0001',
        status: 'FINALIZED',
        total_gross: '54.00',
        issued_at: '2026-09-25T10:00:00.000Z',
      },
    ]);
  });

  it('links the workshop and sales orders, reading their numbers only within the active site', async () => {
    const row = {
      ...detailRecord({
        workshop_order_id: WORKSHOP_ORDER_ID,
        sales_order_id: SALES_ORDER_ID,
      }),
      tenant_id: TENANT_A,
      site_id: SITE_A,
    };
    const { service, prisma } = build({ store: [row] });
    prisma.workshopOrder.findFirst.mockResolvedValue({
      id: WORKSHOP_ORDER_ID,
      order_number: 'WO-2026-0042',
    });
    prisma.salesOrder.findFirst.mockResolvedValue(null);

    const invoice = await service.getInvoice({ invoice_id: INVOICE_ID });

    expect(prisma.workshopOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: WORKSHOP_ORDER_ID, tenant_id: TENANT_A, site_id: SITE_A },
      }),
    );
    expect(prisma.salesOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SALES_ORDER_ID, tenant_id: TENANT_A, site_id: SITE_A },
      }),
    );
    expect(invoice.workshop_order).toEqual({
      id: WORKSHOP_ORDER_ID,
      order_number: 'WO-2026-0042',
    });
    expect(invoice.sales_order).toEqual({ id: SALES_ORDER_ID, order_number: null });
  });

  it('caps the lines to the result limit and reports how many there were', async () => {
    const items = Array.from({ length: 400 }, (_, index) => ({
      description: `Position ${index} mit einer etwas längeren Beschreibung`,
      quantity: new Prisma.Decimal('1'),
      unit_price: new Prisma.Decimal('10'),
      tax_rate: new Prisma.Decimal('20'),
      line_discount_type: null,
      line_discount_value: null,
    }));
    const row = {
      ...detailRecord({ status: InvoiceStatus.DRAFT, snapshot: null, items }),
      tenant_id: TENANT_A,
      site_id: SITE_A,
    };
    const { service } = build({ store: [row] });

    const invoice = await service.getInvoice({ invoice_id: INVOICE_ID });

    expect(invoice.lines_total).toBe(400);
    expect(invoice.lines_truncated).toBe(true);
    expect(invoice.lines.length).toBeLessThan(400);
    expect(JSON.stringify(invoice).length).toBeLessThanOrEqual(32_768);
  });
});
