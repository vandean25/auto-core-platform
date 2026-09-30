import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  DiscountType,
  InvoiceStatus,
  Prisma,
  WorkshopOrderStatus,
  WorkshopPartLineExecutionStatus,
} from '@prisma/client';
import {
  assertDiscountPair,
  buildDraftInvoiceLineItem,
  buildInvoiceCustomerAddressSnapshot,
  buildInvoiceDueDate,
  calculateInvoiceTotals,
  executeCreateDraftInvoice,
  validateCustomerAddress,
  DEFAULT_VAT_RATE,
} from './invoice-creation.helpers.js';

describe('invoice-creation.helpers', () => {
  describe('validateCustomerAddress', () => {
    it('throws BadRequestException when customer is null or undefined', () => {
      expect(() => validateCustomerAddress(null)).toThrow(BadRequestException);
      expect(() => validateCustomerAddress(undefined)).toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when street is missing or whitespace', () => {
      expect(() =>
        validateCustomerAddress({
          street: '',
          city: 'Vienna',
          postal_code: '1010',
          country: 'Austria',
        }),
      ).toThrow(BadRequestException);

      expect(() =>
        validateCustomerAddress({
          street: '   ',
          city: 'Vienna',
          postal_code: '1010',
          country: 'Austria',
        }),
      ).toThrow(BadRequestException);
    });

    it('throws BadRequestException when city is missing', () => {
      expect(() =>
        validateCustomerAddress({
          street: 'Main St 1',
          city: null,
          postal_code: '1010',
          country: 'Austria',
        }),
      ).toThrow(BadRequestException);
    });

    it('throws BadRequestException when postal_code is missing', () => {
      expect(() =>
        validateCustomerAddress({
          street: 'Main St 1',
          city: 'Vienna',
          postal_code: undefined,
          country: 'Austria',
        }),
      ).toThrow(BadRequestException);
    });

    it('throws BadRequestException when country is missing', () => {
      expect(() =>
        validateCustomerAddress({
          street: 'Main St 1',
          city: 'Vienna',
          postal_code: '1010',
          country: '',
        }),
      ).toThrow(BadRequestException);
    });

    it('passes when complete with street/city/postal_code/country', () => {
      expect(() =>
        validateCustomerAddress({
          street: 'Main St 1',
          city: 'Vienna',
          postal_code: '1010',
          country: 'Austria',
        }),
      ).not.toThrow();
    });

    it('passes when complete using address_street/address_city/address_zip/address_country', () => {
      expect(() =>
        validateCustomerAddress({
          address_street: 'Ringstrasse 5',
          address_city: 'Graz',
          address_zip: '8010',
          address_country: 'Austria',
        }),
      ).not.toThrow();
    });
  });

  describe('buildInvoiceCustomerAddressSnapshot', () => {
    it('returns normalized address snapshot with trimmed fields', () => {
      const snapshot = buildInvoiceCustomerAddressSnapshot({
        street: '  Kärntner Strasse 10  ',
        city: '  Vienna  ',
        postal_code: '  1010  ',
        country: '  AT  ',
      });

      expect(snapshot).toEqual({
        street: 'Kärntner Strasse 10',
        city: 'Vienna',
        postal_code: '1010',
        country: 'AT',
      });
    });

    it('throws when address is incomplete', () => {
      expect(() =>
        buildInvoiceCustomerAddressSnapshot({
          street: 'Kärntner Strasse 10',
          city: 'Vienna',
          postal_code: null,
          country: 'AT',
        }),
      ).toThrow(BadRequestException);
    });
  });

  describe('assertDiscountPair', () => {
    it('passes when both type and value are absent', () => {
      expect(() => assertDiscountPair('Line 1', null, null)).not.toThrow();
      expect(() =>
        assertDiscountPair('Line 1', undefined, undefined),
      ).not.toThrow();
    });

    it('passes when both type and value are present', () => {
      expect(() =>
        assertDiscountPair('Line 1', DiscountType.PERCENTAGE, 10),
      ).not.toThrow();
    });

    it('throws BadRequestException when only type is provided', () => {
      expect(() =>
        assertDiscountPair('Line 1', DiscountType.PERCENTAGE, null),
      ).toThrow(BadRequestException);
    });

    it('throws BadRequestException when only value is provided', () => {
      expect(() => assertDiscountPair('Line 1', null, 10)).toThrow(
        BadRequestException,
      );
    });
  });

  describe('buildInvoiceDueDate', () => {
    it('calculates due date with default 14 days', () => {
      const from = new Date('2026-05-01T00:00:00.000Z');
      const due = buildInvoiceDueDate(from);
      expect(due.toISOString().slice(0, 10)).toBe('2026-05-15');
    });

    it('calculates due date with custom due days', () => {
      const from = new Date('2026-05-01T00:00:00.000Z');
      const due = buildInvoiceDueDate(from, 30);
      expect(due.toISOString().slice(0, 10)).toBe('2026-05-31');
    });
  });

  describe('buildDraftInvoiceLineItem', () => {
    it('snapshots unit price, description, and tax rate', () => {
      const line = buildDraftInvoiceLineItem(
        {
          catalog_item_id: 'cat-1',
          description: 'Brake Fluid Flush',
          quantity: 2,
          unit_price: 45,
          tax_rate: 20,
        },
        0,
        'tenant-123',
      );

      expect(line.tenant_id).toBe('tenant-123');
      expect(line.catalog_item_id).toBe('cat-1');
      expect(line.description).toBe('Brake Fluid Flush');
      expect(line.quantity).toEqual(new Prisma.Decimal(2));
      expect(line.unit_price).toEqual(new Prisma.Decimal(45));
      expect(line.tax_rate).toEqual(new Prisma.Decimal(20));
      expect(line.line_total).toEqual(new Prisma.Decimal(90));
      expect(line.revenue_group_name).toBeNull();
    });

    it('assigns Labor revenue group when type is LABOR', () => {
      const line = buildDraftInvoiceLineItem({
        description: 'Brake Inspection Labor',
        quantity: 1.5,
        unit_price: 80,
        type: 'LABOR',
      });

      expect(line.revenue_group_name).toBe('Labor / workshop services');
    });

    it('preserves custom revenue_group_name if specified', () => {
      const line = buildDraftInvoiceLineItem({
        description: 'Parts line',
        quantity: 1,
        unit_price: 50,
        type: 'PART',
        revenue_group_name: 'Custom Parts Revenue',
      });

      expect(line.revenue_group_name).toBe('Custom Parts Revenue');
    });

    it('snapshots discount type and value when both are provided', () => {
      const line = buildDraftInvoiceLineItem({
        description: 'Discounted service',
        quantity: 1,
        unit_price: 100,
        line_discount_type: DiscountType.FLAT_AMOUNT,
        line_discount_value: 15,
      });

      expect(line.line_discount_type).toBe(DiscountType.FLAT_AMOUNT);
      expect(line.line_discount_value).toEqual(new Prisma.Decimal(15));
    });

    it('throws BadRequestException if discount pair is invalid', () => {
      expect(() =>
        buildDraftInvoiceLineItem(
          {
            description: 'Invalid discount',
            quantity: 1,
            unit_price: 100,
            line_discount_type: DiscountType.PERCENTAGE,
            line_discount_value: null,
          },
          2,
        ),
      ).toThrow(BadRequestException);
    });
  });

  describe('calculateInvoiceTotals', () => {
    it('correctly calculates totals for multiple items with different tax rates and quantities', () => {
      const lineItems = [
        {
          quantity: new Prisma.Decimal(2),
          unit_price: new Prisma.Decimal(50),
          tax_rate: new Prisma.Decimal(20), // net: 100, tax: 20
        },
        {
          quantity: 3,
          unit_price: 10,
          tax_rate: 10, // net: 30, tax: 3
        },
        {
          quantity: 1,
          unit_price: 100, // default VAT rate: 20% -> net: 100, tax: 20
        },
      ];

      const totals = calculateInvoiceTotals(lineItems);

      expect(totals.subtotal).toEqual(new Prisma.Decimal(230));
      expect(totals.taxTotal).toEqual(new Prisma.Decimal(43));
      expect(totals.total).toEqual(new Prisma.Decimal(273));
      expect(totals.totalNet).toEqual(totals.subtotal);
      expect(totals.totalTax).toEqual(totals.taxTotal);
      expect(totals.totalGross).toEqual(totals.total);
    });

    it('handles empty line items returning zero totals', () => {
      const totals = calculateInvoiceTotals([]);

      expect(totals.subtotal).toEqual(new Prisma.Decimal(0));
      expect(totals.taxTotal).toEqual(new Prisma.Decimal(0));
      expect(totals.total).toEqual(new Prisma.Decimal(0));
    });
  });

  describe('executeCreateDraftInvoice', () => {
    const mockTx = {
      workshopOrder: {
        findFirst: jest.fn(),
      },
      site: {
        findFirst: jest.fn(),
      },
      invoice: {
        create: jest.fn(),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };

    const mockPrisma = {
      $transaction: jest.fn(async (cb: (tx: any) => Promise<any>) =>
        cb(mockTx),
      ),
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('throws NotFoundException when workshop order does not exist', async () => {
      mockTx.workshopOrder.findFirst.mockResolvedValue(null);

      await expect(
        executeCreateDraftInvoice(mockPrisma as any, 'tenant-1', 'site-1', {
          workshopOrderId: 'wo-nonexistent',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when workshop order is already invoiced', async () => {
      mockTx.workshopOrder.findFirst.mockResolvedValue({
        id: 'wo-1',
        invoice: { id: 'inv-1', invoice_number: 'RE-2026-0001' },
      });

      await expect(
        executeCreateDraftInvoice(mockPrisma as any, 'tenant-1', 'site-1', {
          workshopOrderId: 'wo-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when order status is not COMPLETED', async () => {
      mockTx.workshopOrder.findFirst.mockResolvedValue({
        id: 'wo-1',
        status: WorkshopOrderStatus.IN_PROGRESS,
        invoice: null,
      });

      await expect(
        executeCreateDraftInvoice(mockPrisma as any, 'tenant-1', 'site-1', {
          workshopOrderId: 'wo-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when parts reservations block order completion', async () => {
      mockTx.workshopOrder.findFirst.mockResolvedValue({
        id: 'wo-1',
        status: WorkshopOrderStatus.COMPLETED,
        invoice: null,
        tasks: [
          {
            id: 'task-1',
            line_items: [
              {
                part_execution_status:
                  WorkshopPartLineExecutionStatus.PENDING_PICK,
                parts_reservations: [
                  {
                    status: 'OPEN',
                    quantity: 1,
                    quantity_consumed: 0,
                    quantity_returned: 0,
                    quantity_staged: 0,
                  },
                ],
              },
            ],
          },
        ],
      });

      await expect(
        executeCreateDraftInvoice(mockPrisma as any, 'tenant-1', 'site-1', {
          workshopOrderId: 'wo-1',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException when order has no customer', async () => {
      mockTx.workshopOrder.findFirst.mockResolvedValue({
        id: 'wo-1',
        status: WorkshopOrderStatus.COMPLETED,
        invoice: null,
        customer_id: null,
        site_id: 'site-1',
        tasks: [
          {
            id: 'task-1',
            line_items: [
              {
                description: 'Labor',
                quantity: new Prisma.Decimal(1),
                unit_price: new Prisma.Decimal(100),
                part_execution_status:
                  WorkshopPartLineExecutionStatus.COMPLETED,
              },
            ],
          },
        ],
      });

      await expect(
        executeCreateDraftInvoice(mockPrisma as any, 'tenant-1', 'site-1', {
          workshopOrderId: 'wo-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('successfully creates draft invoice within transaction', async () => {
      const order = {
        id: 'wo-1',
        status: WorkshopOrderStatus.COMPLETED,
        invoice: null,
        customer_id: 'cust-1',
        vehicle_id: 'veh-1',
        site_id: 'site-1',
        notes: 'Test notes',
        tasks: [
          {
            id: 'task-1',
            line_items: [
              {
                description: 'Oil Change Labor',
                quantity: new Prisma.Decimal(1),
                unit_price: new Prisma.Decimal(80),
                type: 'LABOR',
                part_execution_status:
                  WorkshopPartLineExecutionStatus.COMPLETED,
              },
            ],
          },
        ],
      };
      mockTx.workshopOrder.findFirst.mockResolvedValue(order);
      mockTx.site.findFirst.mockResolvedValue({
        id: 'site-1',
        legal_entity_id: 'le-1',
      });
      mockTx.invoice.create.mockResolvedValue({
        id: 'inv-created',
        tenant_id: 'tenant-1',
        site_id: 'site-1',
        status: InvoiceStatus.DRAFT,
        customer: { id: 'cust-1' },
        vehicle: null,
        workshop_order: { id: 'wo-1' },
        items: [],
      });

      const result = await executeCreateDraftInvoice(
        mockPrisma as any,
        'tenant-1',
        'site-1',
        { workshopOrderId: 'wo-1' },
      );

      expect(mockTx.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenant_id: 'tenant-1',
            customer_id: 'cust-1',
            workshop_order_id: 'wo-1',
            site_id: 'site-1',
            legal_entity_id: 'le-1',
            status: InvoiceStatus.DRAFT,
            total_net: new Prisma.Decimal(80),
            total_tax: new Prisma.Decimal(16),
            total_gross: new Prisma.Decimal(96),
          }),
        }),
      );
      expect(result.id).toBe('inv-created');
    });
  });
});
