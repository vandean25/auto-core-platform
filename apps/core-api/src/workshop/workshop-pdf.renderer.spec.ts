import { WorkshopPdfRenderer } from './workshop-pdf.renderer.js';
import type { WorkshopOrderForPdf } from './workshop-pdf.types.js';

describe('WorkshopPdfRenderer', () => {
  const createOrder = (
    overrides: Partial<WorkshopOrderForPdf> = {},
  ): WorkshopOrderForPdf => ({
    id: 'order-1',
    order_number: 'WO-1',
    status: 'INTAKE',
    odometer: 12345,
    fuel_level: 50,
    reported_issue: 'Engine noise\nOnly at idle',
    notes: 'Internal note line 1\nInternal note line 2',
    customer: {
      type: 'PRIVATE',
      preferred_language: null,
      first_name: 'Ada',
      last_name: 'Lovelace',
      company_name: null,
      phone: '123456789',
      email: 'ada@example.com',
      address_zip: '1010',
      address_city: 'Wien',
    },
    vehicle: {
      make: 'VW',
      model: 'Golf',
      year: 2020,
      vin: 'VIN-123',
      plate: 'W-1234',
    },
    tasks: [],
    ...overrides,
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders a safe customer placeholder and preserves reported issue formatting', () => {
    const browserService = {
      getBrowser: jest.fn(),
      withTimeout: jest.fn(),
    };
    const renderer = new WorkshopPdfRenderer(browserService as never);
    const html = (renderer as any).generateHtml(
      createOrder({
        customer: {
          type: 'PRIVATE',
          preferred_language: null,
          first_name: '',
          last_name: '',
          company_name: null,
          phone: null,
          email: null,
          address_zip: null,
          address_city: null,
        },
      }),
      'WO-1',
      'en',
      'localized',
    );

    expect(html).toContain('>—<');
    expect(html).toContain('class="issue-box"');
    expect(html).toContain('Reported Issue / Customer Complaint');
    expect(html).toContain('white-space: pre-wrap');
  });

  it('renders German document labels when documentLocale is de', () => {
    const browserService = {
      getBrowser: jest.fn(),
      withTimeout: jest.fn(),
    };
    const renderer = new WorkshopPdfRenderer(browserService as never);
    const html = (renderer as any).generateHtml(createOrder(), 'WO-1', 'de');

    expect(html).toContain('lang="de"');
    expect(html).toContain('Arbeitskarte');
    expect(html).toContain('Gemeldetes Problem / Kundenbeanstandung');
    expect(html).not.toContain('Job Card');
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
    const renderer = new WorkshopPdfRenderer(browserService as never);

    expect(browserService.getBrowser).not.toHaveBeenCalled();
    await expect(
      renderer.render(createOrder(), { documentLocale: 'de' }),
    ).rejects.toThrow(
      'setContent failed',
    );
    expect(browserService.getBrowser).toHaveBeenCalledTimes(1);
    expect(page.close).toHaveBeenCalledTimes(1);
  });

  // AUT-986 Scenario 6 & 7: WO PDF renders invoice letterhead with logo or text-only fallback
  it('renders LegalEntity logo in headerTemplate when branding has a logo, and text-only header when logo is absent', async () => {
    const pdfMock = jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4'));
    const page = {
      route: jest.fn().mockResolvedValue(undefined),
      setContent: jest.fn().mockResolvedValue(undefined),
      pdf: pdfMock,
      close: jest.fn().mockResolvedValue(undefined),
    };
    const browser = {
      newPage: jest.fn().mockResolvedValue(page),
    };
    const browserService = {
      getBrowser: jest.fn().mockResolvedValue(browser),
      withTimeout: jest.fn((promise: Promise<Buffer>) => promise),
    };
    const renderer = new WorkshopPdfRenderer(browserService as never);
    const logoPng = Buffer.from('fake-png-bytes');
    const { createHash } = await import('node:crypto');
    const sha256 = createHash('sha256').update(logoPng).digest('hex');

    await renderer.render(createOrder(), {
      documentLocale: 'de',
      branding: {
        profile_id: 'profile-1',
        schema_version: 1,
        preset_id: 'standard-v1',
        renderer_version: 'invoice-brand-v1',
        font_id: 'acp-sans-v1',
        resolved_at: '2026-10-01T00:00:00.000Z',
        profile_revision: 1,
        tokens: {
          primary_color: '#1e3a8a',
          secondary_color: '#64748b',
          header_band: 'primary',
          footer_band: 'none',
          header_text: 'Autohaus Alpha GmbH',
          footer_text: 'Autohaus Alpha GmbH',
        },
        logo: {
          asset_id: 'asset-1',
          bucket: 'brand-bucket',
          key: 'logos/alpha.png',
          generation: '1',
          sha256,
          mime_type: 'image/png',
          width: 200,
          height: 80,
        },
      },
      logoPng,
    });

    const withLogoCall = pdfMock.mock.calls[0][0] as {
      headerTemplate: string;
      margin: { top: string };
    };
    expect(withLogoCall.margin.top).toBe('32mm');
    expect(withLogoCall.headerTemplate).toContain('<img alt="" src="data:image/png;base64,');
    expect(withLogoCall.headerTemplate).toContain('Autohaus Alpha GmbH');

    pdfMock.mockClear();

    await renderer.render(createOrder(), {
      documentLocale: 'de',
      branding: {
        profile_id: 'profile-2',
        schema_version: 1,
        preset_id: 'standard-v1',
        renderer_version: 'invoice-brand-v1',
        font_id: 'acp-sans-v1',
        resolved_at: '2026-10-01T00:00:00.000Z',
        profile_revision: 1,
        tokens: {
          primary_color: '#1e3a8a',
          secondary_color: '#64748b',
          header_band: 'primary',
          footer_band: 'none',
          header_text: 'Autohaus Beta GmbH',
          footer_text: 'Autohaus Beta GmbH',
        },
        logo: null,
      },
    });

    const withoutLogoCall = pdfMock.mock.calls[0][0] as {
      headerTemplate: string;
      margin: { top: string };
    };
    expect(withoutLogoCall.margin.top).toBe('32mm');
    expect(withoutLogoCall.headerTemplate).not.toContain('<img');
    expect(withoutLogoCall.headerTemplate).toContain('<span></span>');
    expect(withoutLogoCall.headerTemplate).toContain('Autohaus Beta GmbH');
  });
});
