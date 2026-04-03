import { Decimal } from '@prisma/client/runtime/library';
import { buildInvoiceSnapshot } from './invoice-snapshot';
import { CustomerType } from '@prisma/client';

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
      created_at: new Date(),
      updated_at: new Date(),
    },
    vehicle: null,
    created_at: new Date(),
    updated_at: new Date(),
    status: 'DRAFT' as any,
    customer_id: 'cust-1',
    vehicle_id: null,
  };

  it('should verify mathematical accuracy: total_net + total_tax === total_gross', () => {
    const invoice = {
      ...baseInvoice,
      total_net: new Decimal('100.00'),
      total_tax: new Decimal('20.00'),
      total_gross: new Decimal('120.00'),
      items: [
        {
          id: 'item-1',
          invoice_id: 'inv-123',
          description: 'Service',
          quantity: new Decimal('1.00'),
          unit_price: new Decimal('100.00'),
          tax_rate: new Decimal('20.00'),
          line_discount_type: null,
          line_discount_value: null,
          line_total: new Decimal('120.00'),
          revenue_group_name: null,
        },
      ],
    };

    const snapshot = buildInvoiceSnapshot(invoice);

    expect(snapshot.total_net).toBe('100.00');
    expect(snapshot.total_tax).toBe('20.00');
    expect(snapshot.total_gross).toBe('120.00');

    const net = parseFloat(snapshot.total_net);
    const tax = parseFloat(snapshot.total_tax);
    const gross = parseFloat(snapshot.total_gross);

    expect(net + tax).toBeCloseTo(gross);
  });

  it('should verify correct rounding of Decimal values', () => {
    const invoice = {
      ...baseInvoice,
      total_net: new Decimal('100.1234'),
      total_tax: new Decimal('20.1234'),
      total_gross: new Decimal('120.2468'),
      items: [
        {
          id: 'item-1',
          invoice_id: 'inv-123',
          description: 'Service',
          quantity: new Decimal('1.00'),
          unit_price: new Decimal('100.1234'),
          tax_rate: new Decimal('20.1234'),
          line_discount_type: null,
          line_discount_value: null,
          line_total: new Decimal('120.2468'),
          revenue_group_name: null,
        },
      ],
    };

    const snapshot = buildInvoiceSnapshot(invoice);

    expect(snapshot.total_net).toBe('100.1234');
    expect(snapshot.total_tax).toBe('20.1234');
    expect(snapshot.total_gross).toBe('120.2468');

    // Ensure it correctly passes string representation of decimal
  });

  it('should verify handling of zero-tax and discounted items', () => {
    const invoice = {
      ...baseInvoice,
      total_net: new Decimal('90.00'),
      total_tax: new Decimal('0.00'),
      total_gross: new Decimal('90.00'),
      items: [
        {
          id: 'item-1',
          invoice_id: 'inv-123',
          description: 'Discounted Service',
          quantity: new Decimal('1.00'),
          unit_price: new Decimal('100.00'),
          tax_rate: new Decimal('0.00'),
          line_discount_type: 'PERCENTAGE',
          line_discount_value: new Decimal('10.00'),
          line_total: new Decimal('90.00'),
          revenue_group_name: null,
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

    const net = parseFloat(snapshot.total_net);
    const tax = parseFloat(snapshot.total_tax);
    const gross = parseFloat(snapshot.total_gross);

    expect(net + tax).toBeCloseTo(gross);
  });
});
