import {
  buildInvoicePdfMargin,
  buildInvoicePdfOptions,
} from './invoice-pdf-render-options.helpers.js';
import type { InvoiceSnapshot } from './invoice-snapshot.js';

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
  items: [],
  snapshot_created_at: '2026-04-07T12:00:00.000Z',
});

const createBrandedSnapshot = (): InvoiceSnapshot => ({
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
    logo: null,
    resolved_at: '2026-04-07T12:00:00.000Z',
  },
});

describe('buildInvoicePdfMargin', () => {
  it('uses the letterhead margins for branded invoices', () => {
    expect(buildInvoicePdfMargin(true)).toEqual({
      top: '32mm',
      right: '16mm',
      bottom: '28mm',
      left: '16mm',
    });
  });

  it('uses the standard margins for unbranded invoices', () => {
    expect(buildInvoicePdfMargin(false)).toEqual({
      top: '50px',
      right: '50px',
      bottom: '70px',
      left: '50px',
    });
  });
});

describe('buildInvoicePdfOptions', () => {
  it('renders standard invoices with an empty header and a page-number footer', () => {
    const options = buildInvoicePdfOptions({
      snapshot: createSnapshot(),
      invoiceNumber: 'RE-2026-0001',
      branded: false,
      logoDataUrl: null,
      fontFaceCss: '',
    });

    expect(options).toMatchObject({
      format: 'A4',
      displayHeaderFooter: true,
      printBackground: true,
      headerTemplate: '<div></div>',
    });
    expect(options.margin).toEqual(buildInvoicePdfMargin(false));
    expect(options.footerTemplate).toContain('Invoice RE-2026-0001');
  });

  it('renders branded invoices with the frozen header chrome, logo and footer text', () => {
    const options = buildInvoicePdfOptions({
      snapshot: createBrandedSnapshot(),
      invoiceNumber: 'RE-2026-0001',
      branded: true,
      logoDataUrl: 'data:image/png;base64,bG9nbw==',
      fontFaceCss: "@font-face { font-family: 'ACP Sans'; }",
    });

    expect(options).toMatchObject({
      format: 'A4',
      displayHeaderFooter: true,
      printBackground: true,
    });
    expect(options.margin).toEqual(buildInvoicePdfMargin(true));
    expect(options.headerTemplate).toContain('Workshop &amp; North');
    expect(options.headerTemplate).toContain('@font-face');
    expect(options.headerTemplate).toContain('data:image/png;base64,bG9nbw==');
    expect(options.footerTemplate).toContain('Vienna');
  });
});
