import { InvoicePdfRenderer } from './invoice-pdf.renderer';
import type { InvoiceSnapshot } from './invoice-snapshot';

describe('InvoicePdfRenderer', () => {
  const createSnapshot = (): InvoiceSnapshot => ({
    id: 'invoice-1',
    invoice_number: 'RE-2026-0001',
    date: '2026-04-07',
    due_date: '2026-04-14',
    total_net: '100.00',
    total_tax: '20.00',
    total_gross: '120.00',
    notes: 'Test note',
    tax_mode: 'STANDARD',
    customer: {
      type: 'PRIVATE',
      company_name: null,
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: null,
      phone: null,
      vat_id: null,
      address_street: null,
      address_city: 'Wien',
      address_zip: '1010',
      address_country: null,
    },
    vehicle: null,
    items: [
      {
        description: 'Service',
        quantity: '1',
        unit_price: '100.00',
        tax_rate: '20',
        line_discount_type: null,
        line_discount_value: null,
        line_total: '100.00',
        revenue_group_name: null,
      },
    ],
    snapshot_created_at: '2026-04-07T12:00:00.000Z',
  });

  it('requests the browser lazily and closes the page when rendering fails', async () => {
    const page = {
      setContent: jest.fn().mockRejectedValue(new Error('setContent failed')),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const browser = {
      newPage: jest.fn().mockResolvedValue(page),
    };
    const browserService = {
      getBrowser: jest.fn().mockResolvedValue(browser),
      withTimeout: jest.fn((promise: Promise<Buffer>) => promise),
    };

    const renderer = new InvoicePdfRenderer(browserService as never);

    expect(browserService.getBrowser).not.toHaveBeenCalled();
    await expect(renderer.render(createSnapshot())).rejects.toThrow(
      'setContent failed',
    );
    expect(browserService.getBrowser).toHaveBeenCalledTimes(1);
    expect(page.close).toHaveBeenCalledTimes(1);
  });

  it('includes Differenzbesteuerung legal line for margin-scheme invoices', async () => {
    const page = {
      setContent: jest.fn().mockResolvedValue(undefined),
      pdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const browser = {
      newPage: jest.fn().mockResolvedValue(page),
    };
    const browserService = {
      getBrowser: jest.fn().mockResolvedValue(browser),
      withTimeout: jest.fn((promise: Promise<Buffer>) => promise),
    };

    const renderer = new InvoicePdfRenderer(browserService as never);
    await renderer.render({
      ...createSnapshot(),
      tax_mode: 'MARGIN_SCHEME',
    });

    expect(page.setContent).toHaveBeenCalledWith(
      expect.stringContaining(
        'Differenzbesteuerung gemäß § 24 UStG (Gebrauchtgegenstände).',
      ),
      expect.any(Object),
    );
  });

  it('omits the margin legal line for standard invoices', async () => {
    const page = {
      setContent: jest.fn().mockResolvedValue(undefined),
      pdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const browser = {
      newPage: jest.fn().mockResolvedValue(page),
    };
    const browserService = {
      getBrowser: jest.fn().mockResolvedValue(browser),
      withTimeout: jest.fn((promise: Promise<Buffer>) => promise),
    };

    const renderer = new InvoicePdfRenderer(browserService as never);
    await renderer.render(createSnapshot());

    expect(page.setContent).toHaveBeenCalledWith(
      expect.not.stringContaining('Differenzbesteuerung'),
      expect.any(Object),
    );
  });
});
