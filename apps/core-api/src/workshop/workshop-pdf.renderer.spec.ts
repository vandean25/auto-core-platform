import { WorkshopPdfRenderer } from './workshop-pdf.renderer';
import type { WorkshopOrderForPdf } from './workshop-pdf.types';

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
    );

    expect(html).toContain('>—<');
    expect(html).toContain('class="issue-box"');
    expect(html).toContain('Reported Issue / Customer Complaint');
    expect(html).toContain('white-space: pre-wrap');
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
    await expect(renderer.render(createOrder())).rejects.toThrow(
      'setContent failed',
    );
    expect(browserService.getBrowser).toHaveBeenCalledTimes(1);
    expect(page.close).toHaveBeenCalledTimes(1);
  });
});
