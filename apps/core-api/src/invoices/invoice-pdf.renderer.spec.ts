import { createHash } from 'node:crypto';
import { InvoicePdfRenderer } from './invoice-pdf.renderer.js';
import type { InvoiceSnapshot } from './invoice-snapshot.js';

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

    const html = page.setContent.mock.calls[0][0] as string;
    expect(html).toContain(
      'Differenzbesteuerung gemäß § 24 UStG (Gebrauchtgegenstände).',
    );
    expect(html).not.toContain('<span>Tax:</span>');
    expect(html).not.toContain('<span>Net:</span>');
  });

  it('renders DACH Rechnung content for v2 snapshots', async () => {
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
      schema_version: 2,
      seller: {
        name: 'E2E GmbH',
        country_iso: 'DE',
        address_street: 'Hauptstraße 1',
        address_line2: null,
        address_zip: '10115',
        address_city: 'Berlin',
        tax_number: null,
        vat_id: 'DE123456789',
        iban: null,
        bic: null,
        bank_name: null,
        email: null,
        phone: null,
        registration_number: null,
        registration_court: null,
        representatives: null,
      },
      supply_date_from: '2026-09-20',
      supply_date_to: '2026-09-20',
      payment_terms: {
        days: 14,
        text: 'Zahlbar innerhalb von 14 Tagen.',
      },
      currency: 'EUR',
    });

    const html = page.setContent.mock.calls[0][0] as string;
    expect(html).toContain('<h1>Rechnung</h1>');
    expect(html).toContain('E2E GmbH');
    expect(html).toContain('Zahlungsbedingungen:');
    expect(html).not.toContain('<h1>Invoice</h1>');
  });

  it('renders invoice-brand-v1 chrome from frozen branding and exact logo bytes', async () => {
    const page = {
      route: jest.fn().mockResolvedValue(undefined),
      setContent: jest.fn().mockResolvedValue(undefined),
      pdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const browser = { newPage: jest.fn().mockResolvedValue(page) };
    const browserService = {
      getBrowser: jest.fn().mockResolvedValue(browser),
      withTimeout: jest.fn((promise: Promise<Buffer>) => promise),
    };
    const renderer = new InvoicePdfRenderer(browserService as never);

    await renderer.render(
      {
        ...createSnapshot(),
        schema_version: 2,
        template_version: 'invoice-brand-v1',
        branding: {
          schema_version: 1,
          profile_id: 'profile-1',
          profile_revision: 3,
          preset_id: 'standard-v1',
          renderer_version: 'invoice-brand-v1',
          font_id: 'acp-sans-v1',
          tokens: {
            primary_color: '#334155',
            secondary_color: '#E5E7EB',
            header_band: 'primary',
            footer_band: 'secondary',
            header_text: 'Workshop & North',
            footer_text: 'Vienna',
          },
          logo: {
            asset_id: 'asset-1',
            bucket: 'private-bucket',
            key: 'private/logo.png',
            generation: '17',
            sha256: createHash('sha256')
              .update(Buffer.from('logo'))
              .digest('hex'),
            mime_type: 'image/png',
            width: 120,
            height: 40,
          },
          resolved_at: '2026-04-07T12:00:00.000Z',
        },
      },
      { logoPng: Buffer.from('logo') },
    );

    const pdfOptions = page.pdf.mock.calls[0][0];
    const html = page.setContent.mock.calls[0][0] as string;
    expect(html).toContain("font-family: 'ACP Sans'");
    expect(html).toContain('Service');
    expect(html).toContain('120.00');
    expect(pdfOptions.margin).toEqual({
      top: '32mm',
      right: '16mm',
      bottom: '28mm',
      left: '16mm',
    });
    expect(pdfOptions.headerTemplate).toContain('Workshop &amp; North');
    expect(pdfOptions.headerTemplate).toContain('@font-face');
    expect(pdfOptions.footerTemplate).toContain('@font-face');
    expect(pdfOptions.headerTemplate).toContain('data:image/png;base64,bG9nbw==');
    expect(pdfOptions.footerTemplate).toContain('Vienna');
  });

  it('aborts external requests during branded rendering', async () => {
    let registeredHandler:
      | ((route: { abort: () => Promise<void> }) => Promise<void>)
      | undefined;
    const page = {
      route: jest.fn(
        async (
          _url: RegExp,
          handler: (route: { abort: () => Promise<void> }) => Promise<void>,
        ) => {
          registeredHandler = handler;
        },
      ),
      setContent: jest.fn().mockResolvedValue(undefined),
      pdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const browser = { newPage: jest.fn().mockResolvedValue(page) };
    const browserService = {
      getBrowser: jest.fn().mockResolvedValue(browser),
      withTimeout: jest.fn((promise: Promise<Buffer>) => promise),
    };
    const renderer = new InvoicePdfRenderer(browserService as never);

    await renderer.render({
      ...createSnapshot(),
      schema_version: 2,
      template_version: 'invoice-brand-v1',
      branding: {
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
          header_text: 'https://attacker.example/logo.png',
          footer_text: '',
        },
        logo: null,
        resolved_at: '2026-04-07T12:00:00.000Z',
      },
    });

    expect(page.route).toHaveBeenCalledTimes(1);
    expect(page.route).toHaveBeenCalledWith(
      /^https?:\/\//,
      expect.any(Function),
    );
    expect(page.route.mock.invocationCallOrder[0]).toBeLessThan(
      page.setContent.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );

    const abort = jest.fn().mockResolvedValue(undefined);
    await registeredHandler?.({ abort });

    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('renders VAT rate buckets for v2 standard snapshots', async () => {
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
      schema_version: 2,
      seller: {
        name: 'E2E GmbH',
        country_iso: 'DE',
        address_street: 'Hauptstraße 1',
        address_line2: null,
        address_zip: '10115',
        address_city: 'Berlin',
        tax_number: null,
        vat_id: 'DE123456789',
        iban: null,
        bic: null,
        bank_name: null,
        email: null,
        phone: null,
        registration_number: null,
        registration_court: null,
        representatives: null,
      },
      supply_date_from: '2026-09-20',
      supply_date_to: '2026-09-20',
      payment_terms: {
        days: 14,
        text: 'Zahlbar innerhalb von 14 Tagen.',
      },
      currency: 'EUR',
      tax_breakdown: [
        { rate: '20.00', net: '100.00', tax: '20.00', gross: '120.00' },
      ],
    });

    const html = page.setContent.mock.calls[0][0] as string;
    expect(html).toContain('Umsatzsteuer-Aufschlüsselung');
    expect(html).toContain('20.00 % USt');
    expect(html).not.toContain('cost_basis');
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
