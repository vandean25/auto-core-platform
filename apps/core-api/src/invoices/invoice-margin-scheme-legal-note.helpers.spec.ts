import { InvoiceTaxMode } from '@prisma/client';
import {
  DEFAULT_AT_PROFILE_CODE,
  DEFAULT_DE_PROFILE_CODE,
  defaultProfileCodeForCountry,
} from '../finance/accounting-profile/accounting-profile.codes.js';
import { resolveInvoiceMarginSchemeLegalNote } from './invoice-margin-scheme-legal-note.helpers.js';
import { MARGIN_SCHEME_LEGAL_NOTES } from './margin-scheme-legal-notes.js';
import { createMarginSchemeSnapshotV2 } from './margin-scheme-snapshot.spec.support.js';

describe('margin-scheme country profile selection', () => {
  it('selects the AT note from the committed AT seller snapshot', () => {
    expect(
      resolveInvoiceMarginSchemeLegalNote({
        tax_mode: InvoiceTaxMode.MARGIN_SCHEME,
        snapshot: createMarginSchemeSnapshotV2('AT'),
      }),
    ).toBe(MARGIN_SCHEME_LEGAL_NOTES.AT);
  });

  it('selects the DE note from the committed DE seller snapshot', () => {
    expect(
      resolveInvoiceMarginSchemeLegalNote({
        tax_mode: InvoiceTaxMode.MARGIN_SCHEME,
        snapshot: createMarginSchemeSnapshotV2('DE'),
      }),
    ).toBe(MARGIN_SCHEME_LEGAL_NOTES.DE);
  });

  it('returns no margin note for STANDARD invoices', () => {
    expect(
      resolveInvoiceMarginSchemeLegalNote({
        tax_mode: InvoiceTaxMode.STANDARD,
        snapshot: createMarginSchemeSnapshotV2('AT'),
      }),
    ).toBeUndefined();
  });

  it('fails closed for seller countries outside AT and DE', () => {
    const snapshot = createMarginSchemeSnapshotV2('AT');
    const chSnapshot = {
      ...snapshot,
      seller: { ...snapshot.seller, country_iso: 'CH' as unknown as 'AT' },
    };

    expect(
      resolveInvoiceMarginSchemeLegalNote({
        tax_mode: InvoiceTaxMode.MARGIN_SCHEME,
        snapshot: chSnapshot,
      }),
    ).toBeUndefined();
  });

  it('fails closed without a v2 snapshot', () => {
    expect(
      resolveInvoiceMarginSchemeLegalNote({
        tax_mode: InvoiceTaxMode.MARGIN_SCHEME,
        snapshot: null,
      }),
    ).toBeUndefined();
    expect(
      resolveInvoiceMarginSchemeLegalNote({
        tax_mode: InvoiceTaxMode.MARGIN_SCHEME,
        snapshot: { schema_version: 1 },
      }),
    ).toBeUndefined();
  });

  it('pins the AUT-358 wording that the selection resolves to', () => {
    expect(MARGIN_SCHEME_LEGAL_NOTES.AT).toBe(
      'Differenzbesteuerung gemäß § 24 UStG 1994 (Gebrauchtgegenstände).',
    );
    expect(MARGIN_SCHEME_LEGAL_NOTES.DE).toBe(
      'Gebrauchtgegenstände/Sonderregelung – Differenzbesteuerung gemäß § 25a UStG.',
    );
  });

  it('keeps the profile identity in the margin snapshot without a new field', () => {
    const snapshot = createMarginSchemeSnapshotV2('AT');

    expect(snapshot.schema_version).toBe(2);
    expect(snapshot.country_profile_version).toBe('legal-invoicing-v1');
    expect(snapshot.seller.country_iso).toBe('AT');
    expect(snapshot.tax_mode).toBe(InvoiceTaxMode.MARGIN_SCHEME);
    expect(snapshot.margin?.calculation_profile).toBe('vehicle-margin-v1');
    expect(snapshot.items[0].accounting_allocation).toMatchObject({
      profileCode: DEFAULT_AT_PROFILE_CODE,
      profileVersion: 1,
      countryIso: 'AT',
    });
  });

  it('maps each country to its accounting profile code', () => {
    expect(defaultProfileCodeForCountry('AT')).toBe(DEFAULT_AT_PROFILE_CODE);
    expect(defaultProfileCodeForCountry('DE')).toBe(DEFAULT_DE_PROFILE_CODE);
    expect(
      createMarginSchemeSnapshotV2('DE').items[0].accounting_allocation,
    ).toMatchObject({
      profileCode: DEFAULT_DE_PROFILE_CODE,
      countryIso: 'DE',
    });
  });
});
