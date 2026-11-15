import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { jest } from '@jest/globals';
import {
  AuditLogAction,
  CustomerType,
  DiscountType,
  InvoiceStatus,
  InvoiceTaxMode,
  Prisma,
} from '@prisma/client';
import type { AuditService } from '../audit/audit.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import { computeStandardInvoiceTotals } from './invoice-snapshot-v2.js';
import { executeUpdateInvoiceDiscounts } from './invoice-discount.helpers.js';

function d(value: number | string) {
  return new Prisma.Decimal(value);
}

function buildDraftInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    tenant_id: 'tenant-1',
    site_id: 'site-1',
    status: InvoiceStatus.DRAFT,
    tax_mode: InvoiceTaxMode.STANDARD,
    global_discount_type: null as DiscountType | null,
    global_discount_value: null as Prisma.Decimal | null,
    total_net: d('200.00'),
    total_tax: d('40.00'),
    total_gross: d('240.00'),
    items: [
      {
        id: 'line-1',
        tenant_id: 'tenant-1',
        invoice_id: 'inv-1',
        description: 'Brake labor',
        quantity: d('2.000'),
        unit_price: d('50.00'),
        tax_rate: d('20.00'),
        line_discount_type: null as DiscountType | null,
        line_discount_value: null as Prisma.Decimal | null,
        line_total: d('100.00'),
      },
      {
        id: 'line-2',
        tenant_id: 'tenant-1',
        invoice_id: 'inv-1',
        description: 'Brake pads',
        quantity: d('1.000'),
        unit_price: d('100.00'),
        tax_rate: d('20.00'),
        line_discount_type: null as DiscountType | null,
        line_discount_value: null as Prisma.Decimal | null,
        line_total: d('100.00'),
      },
    ],
    customer: {
      id: 'cust-1',
      type: CustomerType.PRIVATE,
      company_name: null,
      first_name: 'Ada',
      last_name: 'Lovelace',
    },
    vehicle: null,
    workshop_order: { id: 'wo-1' },
    ...overrides,
  };
}

function createMocks(invoice: ReturnType<typeof buildDraftInvoice> | null) {
  const tx = {
    $queryRaw: jest
      .fn<() => Promise<Array<{ id: string }>>>()
      .mockResolvedValue(invoice ? [{ id: invoice.id }] : []),
    invoice: {
      findFirst: jest.fn<() => Promise<unknown>>().mockResolvedValue(invoice),
      updateMany: jest
        .fn<() => Promise<{ count: number }>>()
        .mockResolvedValue({ count: 1 }),
    },
    invoiceItem: {
      updateMany: jest
        .fn<() => Promise<{ count: number }>>()
        .mockResolvedValue({ count: 1 }),
    },
  };
  const auditService = {
    recordTenantMutation: jest.fn<() => Promise<void>>().mockResolvedValue(),
  } as unknown as AuditService;
  const tenantContext = {
    getAuthenticatedUser: jest
      .fn()
      .mockReturnValue({ userId: 'user-1', email: 'a@b.c', role: 'OWNER' }),
  } as unknown as TenantContextService;

  return { tx, auditService, tenantContext };
}

describe('executeUpdateInvoiceDiscounts', () => {
  it('Scenario 1: applies line PERCENTAGE discount, recalculates with shared totals, and records audit log', async () => {
    const draft = buildDraftInvoice();
    const updatedInvoice = buildDraftInvoice({
      total_net: d('190.00'),
      total_tax: d('38.00'),
      total_gross: d('228.00'),
    });
    const { tx, auditService, tenantContext } = createMocks(draft);
    tx.invoice.findFirst
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce(updatedInvoice);

    const expected = computeStandardInvoiceTotals(
      [
        {
          id: 'line-1',
          quantity: d('2.000'),
          unitPrice: d('50.00'),
          taxRate: d('20.00'),
          lineDiscountType: DiscountType.PERCENTAGE,
          lineDiscountValue: d('10.00'),
        },
        {
          id: 'line-2',
          quantity: d('1.000'),
          unitPrice: d('100.00'),
          taxRate: d('20.00'),
          lineDiscountType: null,
          lineDiscountValue: null,
        },
      ],
      null,
      null,
    );

    const result = await executeUpdateInvoiceDiscounts(tx as never, {
      tenantId: 'tenant-1',
      siteId: 'site-1',
      invoiceId: 'inv-1',
      dto: {
        lineItems: [
          {
            id: 'line-1',
            discountType: DiscountType.PERCENTAGE,
            discountValue: 10,
          },
        ],
      },
      auditService,
      tenantContext,
    });

    expect(tx.invoiceItem.updateMany).toHaveBeenCalledWith({
      where: { id: 'line-1', invoice_id: 'inv-1', tenant_id: 'tenant-1' },
      data: {
        line_discount_type: DiscountType.PERCENTAGE,
        line_discount_value: d('10.00'),
        line_total: d('90.00'),
      },
    });
    expect(tx.invoice.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'inv-1',
        tenant_id: 'tenant-1',
        site_id: 'site-1',
        status: InvoiceStatus.DRAFT,
      },
      data: {
        global_discount_type: null,
        global_discount_value: null,
        total_net: expected.totalNet,
        total_tax: expected.totalTax,
        total_gross: expected.totalGross,
      },
    });
    expect(auditService.recordTenantMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'Invoice',
        entityId: 'inv-1',
        action: AuditLogAction.UPDATE,
        before: expect.objectContaining({
          global_discount_type: null,
          global_discount_value: null,
        }),
        after: expect.objectContaining({
          line_items: expect.arrayContaining([
            expect.objectContaining({
              id: 'line-1',
              line_discount_type: DiscountType.PERCENTAGE,
              line_discount_value: '10.00',
            }),
          ]),
        }),
      }),
      tx,
    );
    expect(result.id).toBe('inv-1');
  });

  it('clears line and global discounts when explicit null is sent', async () => {
    const draft = buildDraftInvoice({
      global_discount_type: DiscountType.PERCENTAGE,
      global_discount_value: d('5.00'),
      items: [
        {
          id: 'line-1',
          tenant_id: 'tenant-1',
          invoice_id: 'inv-1',
          description: 'Brake labor',
          quantity: d('2.000'),
          unit_price: d('50.00'),
          tax_rate: d('20.00'),
          line_discount_type: DiscountType.FLAT_AMOUNT,
          line_discount_value: d('10.00'),
          line_total: d('90.00'),
        },
      ],
    });
    const { tx, auditService, tenantContext } = createMocks(draft);
    tx.invoice.findFirst.mockResolvedValue(draft);

    await executeUpdateInvoiceDiscounts(tx as never, {
      tenantId: 'tenant-1',
      siteId: 'site-1',
      invoiceId: 'inv-1',
      dto: {
        globalDiscountType: null,
        globalDiscountValue: null,
        lineItems: [{ id: 'line-1', discountType: null, discountValue: null }],
      },
      auditService,
      tenantContext,
    });

    expect(tx.invoiceItem.updateMany).toHaveBeenCalledWith({
      where: { id: 'line-1', invoice_id: 'inv-1', tenant_id: 'tenant-1' },
      data: {
        line_discount_type: null,
        line_discount_value: null,
        line_total: d('100.00'),
      },
    });
    expect(tx.invoice.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'inv-1',
        tenant_id: 'tenant-1',
        site_id: 'site-1',
        status: InvoiceStatus.DRAFT,
      },
      data: {
        global_discount_type: null,
        global_discount_value: null,
        total_net: d('100.00'),
        total_tax: d('20.00'),
        total_gross: d('120.00'),
      },
    });
  });

  it.each([
    [
      'line FLAT_AMOUNT exceeding line net',
      {
        lineItems: [
          {
            id: 'line-1',
            discountType: DiscountType.FLAT_AMOUNT,
            discountValue: 100.01,
          },
        ],
      },
    ],
    [
      'line PERCENTAGE is 0',
      {
        lineItems: [
          {
            id: 'line-1',
            discountType: DiscountType.PERCENTAGE,
            discountValue: 0,
          },
        ],
      },
    ],
    [
      'line PERCENTAGE > 100',
      {
        lineItems: [
          {
            id: 'line-1',
            discountType: DiscountType.PERCENTAGE,
            discountValue: 100.01,
          },
        ],
      },
    ],
    [
      'line only type without value',
      {
        lineItems: [{ id: 'line-1', discountType: DiscountType.PERCENTAGE }],
      },
    ],
    [
      'line only value without type',
      {
        lineItems: [{ id: 'line-1', discountValue: 10 }],
      },
    ],
    [
      'global FLAT_AMOUNT exceeding net after line discounts',
      {
        lineItems: [
          {
            id: 'line-1',
            discountType: DiscountType.FLAT_AMOUNT,
            discountValue: 50,
          },
        ],
        globalDiscountType: DiscountType.FLAT_AMOUNT,
        globalDiscountValue: 150.01,
      },
    ],
    [
      'global PERCENTAGE is 0',
      {
        globalDiscountType: DiscountType.PERCENTAGE,
        globalDiscountValue: 0,
      },
    ],
    [
      'global PERCENTAGE > 100',
      {
        globalDiscountType: DiscountType.PERCENTAGE,
        globalDiscountValue: 101,
      },
    ],
    [
      'global only type without value',
      {
        globalDiscountType: DiscountType.PERCENTAGE,
      },
    ],
    [
      'global only value without type',
      {
        globalDiscountValue: 15,
      },
    ],
  ])(
    'Scenario 2: throws 422 INVOICE_DISCOUNT_INVALID and writes nothing when %s',
    async (_label, dto) => {
      const draft = buildDraftInvoice();
      const { tx, auditService, tenantContext } = createMocks(draft);

      let caught: unknown;
      try {
        await executeUpdateInvoiceDiscounts(tx as never, {
          tenantId: 'tenant-1',
          siteId: 'site-1',
          invoiceId: 'inv-1',
          dto,
          auditService,
          tenantContext,
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(UnprocessableEntityException);
      expect(
        (caught as UnprocessableEntityException).getResponse(),
      ).toMatchObject({ code: 'INVOICE_DISCOUNT_INVALID' });
      expect(tx.invoice.updateMany).not.toHaveBeenCalled();
      expect(tx.invoiceItem.updateMany).not.toHaveBeenCalled();
      expect(auditService.recordTenantMutation).not.toHaveBeenCalled();
    },
  );

  it('preserves existing line discount when lineItems entry omits discountType and discountValue', async () => {
    const draft = buildDraftInvoice();
    draft.items[0].line_discount_type = DiscountType.PERCENTAGE;
    draft.items[0].line_discount_value = d('10.00');
    draft.items[0].line_total = d('90.00');
    const { tx, auditService, tenantContext } = createMocks(draft);

    await executeUpdateInvoiceDiscounts(tx as never, {
      tenantId: 'tenant-1',
      siteId: 'site-1',
      invoiceId: 'inv-1',
      dto: {
        lineItems: [{ id: 'line-1' }],
      },
      auditService,
      tenantContext,
    });

    expect(tx.invoiceItem.updateMany).not.toHaveBeenCalled();
    expect(tx.invoice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          total_net: d('190.00'),
          total_tax: d('38.00'),
          total_gross: d('228.00'),
        }),
      }),
    );
  });

  it.each([
    ['one-sided globalDiscountType null', { globalDiscountType: null }],
    ['one-sided globalDiscountValue null', { globalDiscountValue: null }],
    [
      'duplicate line item ids',
      {
        lineItems: [
          {
            id: 'line-1',
            discountType: DiscountType.PERCENTAGE,
            discountValue: 10,
          },
          {
            id: 'line-1',
            discountType: DiscountType.PERCENTAGE,
            discountValue: 20,
          },
        ],
      },
    ],
  ])(
    'throws 422 INVOICE_DISCOUNT_INVALID and writes nothing for %s',
    async (_label, dto) => {
      const draft = buildDraftInvoice();
      const { tx, auditService, tenantContext } = createMocks(draft);

      let caught: unknown;
      try {
        await executeUpdateInvoiceDiscounts(tx as never, {
          tenantId: 'tenant-1',
          siteId: 'site-1',
          invoiceId: 'inv-1',
          dto,
          auditService,
          tenantContext,
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(UnprocessableEntityException);
      expect(
        (caught as UnprocessableEntityException).getResponse(),
      ).toMatchObject({ code: 'INVOICE_DISCOUNT_INVALID' });
      expect(tx.invoice.updateMany).not.toHaveBeenCalled();
      expect(tx.invoiceItem.updateMany).not.toHaveBeenCalled();
    },
  );

  it('throws 422 INVOICE_DISCOUNT_INVALID when tax_mode is not STANDARD', async () => {
    const marginDraft = buildDraftInvoice({
      tax_mode: InvoiceTaxMode.MARGIN_SCHEME,
    });
    const { tx, auditService, tenantContext } = createMocks(marginDraft);

    let caught: unknown;
    try {
      await executeUpdateInvoiceDiscounts(tx as never, {
        tenantId: 'tenant-1',
        siteId: 'site-1',
        invoiceId: 'inv-1',
        dto: {
          globalDiscountType: DiscountType.PERCENTAGE,
          globalDiscountValue: 10,
        },
        auditService,
        tenantContext,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(UnprocessableEntityException);
    expect(
      (caught as UnprocessableEntityException).getResponse(),
    ).toMatchObject({ code: 'INVOICE_DISCOUNT_INVALID' });
    expect(tx.invoice.updateMany).not.toHaveBeenCalled();
    expect(tx.invoiceItem.updateMany).not.toHaveBeenCalled();
  });

  it('Scenario 3: throws 409 INVOICE_NOT_DRAFT and writes nothing when invoice is not DRAFT', async () => {
    const issued = buildDraftInvoice({ status: InvoiceStatus.ISSUED });
    const { tx, auditService, tenantContext } = createMocks(issued);

    let caught: unknown;
    try {
      await executeUpdateInvoiceDiscounts(tx as never, {
        tenantId: 'tenant-1',
        siteId: 'site-1',
        invoiceId: 'inv-1',
        dto: {
          globalDiscountType: DiscountType.PERCENTAGE,
          globalDiscountValue: 5,
        },
        auditService,
        tenantContext,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ConflictException);
    expect((caught as ConflictException).getResponse()).toMatchObject({
      code: 'INVOICE_NOT_DRAFT',
    });
    expect(tx.invoice.updateMany).not.toHaveBeenCalled();
    expect(tx.invoiceItem.updateMany).not.toHaveBeenCalled();
  });

  it('Scenario 4a: throws 422 INVOICE_DISCOUNT_LINE_NOT_FOUND when a line id does not belong to the invoice', async () => {
    const draft = buildDraftInvoice();
    const { tx, auditService, tenantContext } = createMocks(draft);

    let caught: unknown;
    try {
      await executeUpdateInvoiceDiscounts(tx as never, {
        tenantId: 'tenant-1',
        siteId: 'site-1',
        invoiceId: 'inv-1',
        dto: {
          lineItems: [
            {
              id: 'other-invoice-line',
              discountType: DiscountType.PERCENTAGE,
              discountValue: 10,
            },
          ],
        },
        auditService,
        tenantContext,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(UnprocessableEntityException);
    expect(
      (caught as UnprocessableEntityException).getResponse(),
    ).toMatchObject({ code: 'INVOICE_DISCOUNT_LINE_NOT_FOUND' });
    expect(tx.invoice.updateMany).not.toHaveBeenCalled();
  });

  it('Scenario 4b: throws 404 when invoice does not exist in tenant/site scope', async () => {
    const { tx, auditService, tenantContext } = createMocks(null);

    await expect(
      executeUpdateInvoiceDiscounts(tx as never, {
        tenantId: 'other-tenant',
        siteId: 'site-1',
        invoiceId: 'inv-1',
        dto: {
          globalDiscountType: DiscountType.PERCENTAGE,
          globalDiscountValue: 10,
        },
        auditService,
        tenantContext,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
