import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { UnprocessableEntityException } from '@nestjs/common';
import {
  createRenderInputUnavailableError,
  loadInvoiceFontFaceCss,
  resolveInvoiceLogoDataUrl,
} from './invoice-pdf-render-inputs.helpers.js';
import type { InvoiceSnapshot } from './invoice-snapshot.js';
import type { InvoiceSnapshotV2Branding } from './invoice-snapshot-v2.js';

const LOGO_BYTES = Buffer.from('logo');
const bundledAssetDirectory = fileURLToPath(
  new URL('../document-branding/assets', import.meta.url),
);

const createBrandedSnapshot = (
  logo: InvoiceSnapshotV2Branding['logo'],
): InvoiceSnapshot => ({
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
    logo,
    resolved_at: '2026-04-07T12:00:00.000Z',
  },
});

const frozenLogo = (): NonNullable<InvoiceSnapshotV2Branding['logo']> => ({
  asset_id: 'asset-1',
  bucket: 'private-bucket',
  key: 'private/logo.png',
  generation: '17',
  sha256: createHash('sha256').update(LOGO_BYTES).digest('hex'),
  mime_type: 'image/png',
  width: 120,
  height: 40,
});

describe('resolveInvoiceLogoDataUrl', () => {
  it('returns null when the frozen branding has no logo', () => {
    expect(
      resolveInvoiceLogoDataUrl(createBrandedSnapshot(null), undefined),
    ).toBeNull();
  });

  it('returns a PNG data URL when the logo bytes match the frozen checksum', () => {
    expect(
      resolveInvoiceLogoDataUrl(
        createBrandedSnapshot(frozenLogo()),
        LOGO_BYTES,
      ),
    ).toBe('data:image/png;base64,bG9nbw==');
  });

  it('fails closed when the frozen logo has no bytes supplied', () => {
    expect(() =>
      resolveInvoiceLogoDataUrl(createBrandedSnapshot(frozenLogo()), undefined),
    ).toThrow(UnprocessableEntityException);
  });

  it('fails closed when the logo bytes do not match the frozen checksum', () => {
    expect(() =>
      resolveInvoiceLogoDataUrl(
        createBrandedSnapshot(frozenLogo()),
        Buffer.from('other-bytes'),
      ),
    ).toThrow(UnprocessableEntityException);
  });
});

describe('loadInvoiceFontFaceCss', () => {
  it('embeds the bundled brand fonts as @font-face rules', async () => {
    const css = await loadInvoiceFontFaceCss(bundledAssetDirectory);

    expect(css).toContain('@font-face');
    expect(css).toContain("font-family: 'ACP Sans'");
  });

  it('fails closed when the bundled font files cannot be verified', async () => {
    await expect(
      loadInvoiceFontFaceCss(`${bundledAssetDirectory}/missing`),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('createRenderInputUnavailableError', () => {
  it('describes unavailable frozen branding inputs with a stable error code', () => {
    const error = createRenderInputUnavailableError();

    expect(error.getStatus()).toBe(422);
    expect(error.getResponse()).toEqual({
      code: 'BRAND_RENDER_INPUT_UNAVAILABLE',
      message: 'Frozen branding render inputs are unavailable.',
    });
  });
});
