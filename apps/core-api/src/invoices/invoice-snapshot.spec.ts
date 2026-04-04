import { buildInvoiceSnapshot } from './invoice-snapshot';
import { CustomerType, Prisma, InvoiceStatus, DiscountType } from '@prisma/client';

describe('Invoice Snapshot Integrity', () => {
  const baseInvoice = {
    id: 'inv-123',
    invoice_number: 'INV-2023-001',
    date: new Date('2023-01-01T10:00:00Z'),
    due_date: new Date('2023-01-15T10:00:00Z'),
    notes: 'Thank you for your business',
    customer: {
      id: 'cust-1',
      type: CustomerType.INDIVIDUAL,
      first_name: 'John',
      last_name: 'Doe',
      email: 'john@example.com',
      phone: '123456789',
      vat_id: null,
      address_street: '123 Main St',
      address_city: 'Anytown',
      address_zip: '12345',
      address_country: 'USA',
      company_name: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    vehicle: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    status: InvoiceStatus.DRAFT,
    customer_id: 'cust-1',
    vehicle_id: null,
    global_discount_type: null,
    global_discount_value: null,
    internal_notes: null,
    snapshot: null,
    pdf_storage_bucket: null,
    pdf_storage_key: null,
    pdf_generated_at: null,
    pdf_generation_error: null,
    workshop_order_id: null,
    sales_order_id: null,
  };

  it('should verify mathematical accuracy: total_net + total_tax === total_gross', () => {
    const invoice = {
      ...baseInvoice,
      total_net: new Prisma.Decimal('100.00'),
      total_tax: new Prisma.Decimal('20.00'),
      total_gross: new Prisma.Decimal('120.00'),
      items: [
        {
          id: 'item-1',
          invoice_id: 'inv-123',
          description: 'Service',
          quantity: new Prisma.Decimal('1.00'),
          unit_price: new Prisma.Decimal('100.00'),
          tax_rate: new Prisma.Decimal('20.00'),
          line_discount_type: null,
          line_discount_value: null,
          line_total: new Prisma.Decimal('120.00'),
          revenue_group_name: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    };

    const snapshot = buildInvoiceSnapshot(invoice);

    expect(snapshot.total_net).toBe('100.00');
    expect(snapshot.total_tax).toBe('20.00');
    expect(snapshot.total_gross).toBe('120.00');

    const net = new Prisma.Decimal(snapshot.total_net);
    const tax = new Prisma.Decimal(snapshot.total_tax);
    const gross = new Prisma.Decimal(snapshot.total_gross);

    expect(net.add(tax).equals(gross)).toBe(true);
  });

  it('should verify correct string representation of higher precision decimals (rounded to 2 places)', () => {
    const invoice = {
      ...baseInvoice,
      total_net: new Prisma.Decimal('100.1234'),
      total_tax: new Prisma.Decimal('20.1234'),
      total_gross: new Prisma.Decimal('120.2468'),
      items: [
        {
          id: 'item-1',
          invoice_id: 'inv-123',
          description: 'Service',
          quantity: new Prisma.Decimal('1.00'),
          unit_price: new Prisma.Decimal('100.1234'),
          tax_rate: new Prisma.Decimal('20.1234'),
          line_discount_type: null,
          line_discount_value: null,
          line_total: new Prisma.Decimal('120.2468'),
          revenue_group_name: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    };

    const snapshot = buildInvoiceSnapshot(invoice);

    expect(snapshot.total_net).toBe('100.12');
    expect(snapshot.total_tax).toBe('20.12');
    expect(snapshot.total_gross).toBe('120.25'); // Rounded correctly
  });

  it('should verify handling of zero-tax and discounted items', () => {
    const invoice = {
      ...baseInvoice,
      total_net: new Prisma.Decimal('90.00'),
      total_tax: new Prisma.Decimal('0.00'),
      total_gross: new Prisma.Decimal('90.00'),
      items: [
        {
          id: 'item-1',
          invoice_id: 'inv-123',
          description: 'Discounted Service',
          quantity: new Prisma.Decimal('1.00'),
          unit_price: new Prisma.Decimal('100.00'),
          tax_rate: new Prisma.Decimal('0.00'),
          line_discount_type: DiscountType.PERCENTAGE,
          line_discount_value: new Prisma.Decimal('10.00'),
          line_total: new Prisma.Decimal('90.00'),
          revenue_group_name: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    };

    const snapshot = buildInvoiceSnapshot(invoice);

    expect(snapshot.total_net).toBe('90.00');
    expect(snapshot.total_tax).toBe('0.00');
    expect(snapshot.total_gross).toBe('90.00');
    expect(snapshot.items[0].tax_rate).toBe('0.00');
    expect(snapshot.items[0].line_discount_type).toBe('PERCENTAGE');
    expect(snapshot.items[0].line_discount_value).toBe('10.00');

    const net = new Prisma.Decimal(snapshot.total_net);
    const tax = new Prisma.Decimal(snapshot.total_tax);
    const gross = new Prisma.Decimal(snapshot.total_gross);

    expect(net.add(tax).equals(gross)).toBe(true);
  });
});
