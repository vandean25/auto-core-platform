import { I18N_TRANSLATION_BUNDLE_VERSION } from '../common/i18n/display-language.js';
import { escapeHtml } from '../common/pdf/pdf-layout.js';
import {
  buildInvoiceFooterTemplate,
  buildInvoiceTotalsSection,
  MARGIN_SCHEME_LEGAL_NOTES,
} from '../invoices/invoice-pdf.layout.js';
import { buildCreditNoteSnapshot } from './credit-note-snapshot.js';
import { toRenderableCreditNoteSnapshot } from './credit-note-snapshot-render.adapter.js';

describe('toRenderableCreditNoteSnapshot', () => {
  const snapshot = {
    schema_version: 2,
    document_kind: 'CREDIT_NOTE',
    credit_title: 'Stornorechnung',
    template_version: '2026-09-20',
    country_profile_version: '2026-09-20',
    site_id: 'site-1',
    legal_entity_id: 'legal-1',
    currency: 'EUR',
    seller: {
      name: 'Example GmbH',
      country_iso: 'DE',
      address_street: 'Hauptstraße 1',
      address_line2: null,
      address_zip: '10115',
      address_city: 'Berlin',
      tax_number: '27/123/45678',
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
    customer: {
      type: 'PRIVATE',
      company_name: null,
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'jane@example.com',
      phone: null,
      vat_id: null,
      address_street: 'Kundenstraße 2',
      address_city: 'Berlin',
      address_zip: '10117',
      address_country: 'DE',
    },
    vehicle: null,
    date: '2026-09-22',
    due_date: '2026-09-22',
    supply_date_from: '2026-09-21',
    supply_date_to: '2026-09-21',
    payment_terms: { days: 14, text: '14 Tage netto' },
    items: [
      {
        id: 'line-1',
        description: 'Oil Filter',
        quantity: '2.000',
        unit_price: '50.00',
        tax_rate: '20.00',
        line_discount_type: null,
        line_discount_value: null,
        net: '100.00',
        tax: '20.00',
        gross: '120.00',
        revenue_group_name: 'Parts',
        accounting_allocation: null,
      },
    ],
    tax_breakdown: [
      { rate: '20.00', net: '100.00', tax: '20.00', gross: '120.00' },
    ],
    total_net: '100.00',
    total_tax: '20.00',
    total_gross: '120.00',
    notes: null,
    tax_mode: 'STANDARD',
    snapshot_created_at: '2026-09-22T10:00:00.000Z',
    original_document: {
      id: 'invoice-1',
      number: 'RE-2026-0042',
      date: '2026-09-21',
      reason: 'Wrong quantity billed',
      snapshot_version: 2,
    },
  };

  const localizedSnapshot = (documentLocale: 'de' | 'en') => ({
    ...snapshot,
    document_locale: documentLocale,
    format_locale: 'de-AT' as const,
    translation_bundle_version: I18N_TRANSLATION_BUNDLE_VERSION,
    legal_text_version: null,
  });

  it('maps credit note snapshots for PDF rendering', () => {
    const renderable = toRenderableCreditNoteSnapshot(
      snapshot,
      'CN-2026-0001',
      'credit-1',
    );

    expect(renderable).toMatchObject({
      id: 'credit-1',
      invoice_number: 'CN-2026-0001',
      document_kind: 'CREDIT_NOTE',
      credit_title: 'Stornorechnung',
      original_document: snapshot.original_document,
      total_gross: '120.00',
    });
  });

  it('localizes shared PDF footer page labels via adapter (de)', () => {
    const renderable = toRenderableCreditNoteSnapshot(
      localizedSnapshot('de'),
      'CN-2026-0001',
      'credit-de',
    );
    const footer = buildInvoiceFooterTemplate(
      'CN-2026-0001',
      escapeHtml,
      renderable!,
    );

    expect(footer).toContain('Seite <span class="pageNumber"></span> von');
    expect(footer).not.toMatch(/Page <span class="pageNumber"/);
  });

  it('localizes shared PDF footer page labels via adapter (en)', () => {
    const renderable = toRenderableCreditNoteSnapshot(
      localizedSnapshot('en'),
      'CN-2026-0001',
      'credit-en',
    );
    const footer = buildInvoiceFooterTemplate(
      'CN-2026-0001',
      escapeHtml,
      renderable!,
    );

    expect(footer).toContain('Page <span class="pageNumber"></span> of');
    expect(footer).not.toContain('Seite');
  });

  it('renders DE margin-scheme legal wording on Stornorechnung totals', () => {
    const renderable = toRenderableCreditNoteSnapshot(
      {
        ...snapshot,
        tax_mode: 'MARGIN_SCHEME',
        tax_breakdown: [],
        total_tax: '0.00',
        items: snapshot.items.map((item) => ({
          ...item,
          tax: '0.00',
        })),
      },
      'CN-2026-0099',
      'credit-margin-de',
    );

    const html = buildInvoiceTotalsSection(renderable!, escapeHtml);
    expect(html).toContain(MARGIN_SCHEME_LEGAL_NOTES.DE);
    expect(html).toContain('§ 25a UStG');
    expect(html).not.toContain('§ 24 UStG');
  });

  it('renders AT margin-scheme legal wording on Stornorechnung totals', () => {
    const renderable = toRenderableCreditNoteSnapshot(
      {
        ...snapshot,
        tax_mode: 'MARGIN_SCHEME',
        tax_breakdown: [],
        total_tax: '0.00',
        seller: { ...snapshot.seller, country_iso: 'AT' },
        items: snapshot.items.map((item) => ({
          ...item,
          tax: '0.00',
        })),
      },
      'CN-2026-0100',
      'credit-margin-at',
    );

    const html = buildInvoiceTotalsSection(renderable!, escapeHtml);
    expect(html).toContain(MARGIN_SCHEME_LEGAL_NOTES.AT);
    expect(html).toContain('§ 24 UStG 1994');
    expect(html).not.toContain('§ 25a');
  });

  // AUT-986 Scenario 5 & 7: credit-note adapter preserves invoice-brand-v1 and branding
  it('preserves invoice-brand-v1 template_version and branding when present on credit note snapshot', () => {
    const branding = {
      profile_id: 'profile-1',
      revision: 1,
      tokens: {
        primary_color: '#1e3a8a',
        secondary_color: '#64748b',
        header_band: 'primary' as const,
        footer_band: 'none' as const,
        header_text: 'Werkstatt GmbH',
        footer_text: 'Werkstatt GmbH · Wien',
      },
      logo: {
        asset_id: 'asset-1',
        bucket: 'brand-bucket',
        key: 'logos/entity-1.png',
        generation: '1',
        sha256: 'abc123',
        mime_type: 'image/png' as const,
        width: 200,
        height: 80,
      },
    };
    const renderable = toRenderableCreditNoteSnapshot(
      {
        ...localizedSnapshot('de'),
        template_version: 'invoice-brand-v1',
        branding,
      },
      'CN-2026-0001',
      'credit-1',
    );

    expect(renderable?.template_version).toBe('invoice-brand-v1');
    expect(renderable?.branding).toEqual(branding);
  });

  // AUT-1068 Scenario 3: buildCreditNoteSnapshot formats date, due_date and original_document.date on Europe/Vienna calendar
  it.each([
    {
      label: 'winter CET (UTC+1) 2027-01-01 00:30 Vienna (23:30 UTC)',
      instant: '2026-12-31T23:30:00.000Z',
      expectedDay: '2027-01-01',
    },
    {
      label: 'summer CEST (UTC+2) 2026-07-16 00:30 Vienna (22:30 UTC)',
      instant: '2026-07-15T22:30:00.000Z',
      expectedDay: '2026-07-16',
    },
  ])(
    'formats credit note snapshot dates on the Europe/Vienna calendar for $label',
    ({ instant, expectedDay }) => {
      const built = buildCreditNoteSnapshot({
        originalSnapshot: {
          ...snapshot,
          date: expectedDay,
        } as unknown as Parameters<
          typeof buildCreditNoteSnapshot
        >[0]['originalSnapshot'],
        originalInvoiceId: 'invoice-1',
        originalInvoiceNumber: 'RE-2027-0001',
        originalInvoiceDate: new Date(instant),
        reason: 'Customer return',
        creditDate: new Date(instant),
        isFullCredit: true,
        lineSnapshots: [],
        committedAt: new Date(instant),
      });

      expect(built.date).toBe(expectedDay);
      expect(built.due_date).toBe(expectedDay);
      expect(built.original_document.date).toBe(expectedDay);
    },
  );

  it('preserves originalSnapshot.date on original_document.date when it differs from the Vienna day of invoice.date', () => {
    const preChangeInvoiceInstant = new Date('2026-12-31T23:30:00.000Z');
    const built = buildCreditNoteSnapshot({
      originalSnapshot: {
        ...snapshot,
        date: '2026-12-31',
      } as unknown as Parameters<
        typeof buildCreditNoteSnapshot
      >[0]['originalSnapshot'],
      originalInvoiceId: 'invoice-legacy-utc',
      originalInvoiceNumber: 'RE-2026-0999',
      originalInvoiceDate: preChangeInvoiceInstant,
      reason: 'Pre-change UTC snapshot invoice credit',
      creditDate: new Date('2027-01-01T12:00:00.000Z'),
      isFullCredit: true,
      lineSnapshots: [],
      committedAt: new Date('2027-01-01T12:00:00.000Z'),
    });

    expect(built.date).toBe('2027-01-01');
    expect(built.original_document.date).toBe('2026-12-31');
  });

  // AUT-1087 Scenario 6: reversing an old invoice reverses amounts as issued, not recomputed ones
  it.each([
    {
      label: 'old invoice with line-summed VAT 6.00 < per-rate 6.01 (3 x 10.02 at 20%)',
      unitPrice: '10.02',
      lineTax: '2.00',
      lineGross: '12.02',
      issuedNet: '30.06',
      issuedTax: '6.00',
      issuedGross: '36.06',
    },
    {
      label: 'old invoice with line-summed VAT 6.03 > per-rate 6.02 (3 x 10.03 at 20%)',
      unitPrice: '10.03',
      lineTax: '2.01',
      lineGross: '12.04',
      issuedNet: '30.09',
      issuedTax: '6.03',
      issuedGross: '36.12',
    },
  ])(
    'AUT-1087 S6: reverses $label as issued, not recomputed',
    ({ unitPrice, lineTax, lineGross, issuedNet, issuedTax, issuedGross }) => {
      const lineSnapshots = ['l1', 'l2', 'l3'].map((id) => ({
        original_item_id: id,
        description: 'Part',
        quantity: '1.000',
        unit_price: unitPrice,
        line_discount_type: null,
        line_discount_value: null,
        net: unitPrice,
        tax: lineTax,
        gross: lineGross,
        tax_rate: '20.00',
        revenue_group_name: 'Parts',
        accounting_allocation: {},
      }));

      const built = buildCreditNoteSnapshot({
        originalSnapshot: {
          ...snapshot,
          items: lineSnapshots.map((l) => ({ ...l, id: l.original_item_id })),
          tax_breakdown: [
            { rate: '20.00', net: issuedNet, tax: issuedTax, gross: issuedGross },
          ],
          total_net: issuedNet,
          total_tax: issuedTax,
          total_gross: issuedGross,
        } as unknown as Parameters<
          typeof buildCreditNoteSnapshot
        >[0]['originalSnapshot'],
        originalInvoiceId: 'inv-old',
        originalInvoiceNumber: 'RE-2026-0001',
        originalInvoiceDate: new Date('2026-10-01T10:00:00.000Z'),
        reason: 'Full reversal of old invoice',
        creditDate: new Date('2026-11-01T10:00:00.000Z'),
        isFullCredit: true,
        lineSnapshots,
        committedAt: new Date('2026-11-01T10:00:00.000Z'),
      });

      expect(built.total_net).toBe(issuedNet);
      expect(built.total_tax).toBe(issuedTax);
      expect(built.total_gross).toBe(issuedGross);
      expect(built.tax_breakdown).toEqual([
        { rate: '20.00', net: issuedNet, tax: issuedTax, gross: issuedGross },
      ]);
    },
  );

  it('AUT-1087: full and partial credits on per-rate invoice use per-rate VAT and consume exact remaining cents', () => {
    const originalItems = ['l1', 'l2', 'l3'].map((id) => ({
      id,
      description: 'Part',
      quantity: '1.000',
      unit_price: '10.02',
      tax_rate: '20.00',
      line_discount_type: null,
      line_discount_value: null,
      net: '10.02',
      tax: '2.00',
      gross: '12.02',
      revenue_group_name: 'Parts',
      accounting_allocation: {},
    }));
    const perRateOriginal = {
      ...snapshot,
      items: originalItems,
      tax_breakdown: [
        { rate: '20.00', net: '30.06', tax: '6.01', gross: '36.07' },
      ],
      total_net: '30.06',
      total_tax: '6.01',
      total_gross: '36.07',
    } as unknown as Parameters<
      typeof buildCreditNoteSnapshot
    >[0]['originalSnapshot'];

    const toCreditLine = (item: (typeof originalItems)[number]) => ({
      original_item_id: item.id,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      line_discount_type: null,
      line_discount_value: null,
      net: item.net,
      tax: item.tax,
      gross: item.gross,
      tax_rate: item.tax_rate,
      revenue_group_name: item.revenue_group_name,
      accounting_allocation: {},
    });

    // Full credit on per-rate invoice
    const full = buildCreditNoteSnapshot({
      originalSnapshot: perRateOriginal,
      originalInvoiceId: 'inv-new',
      originalInvoiceNumber: 'RE-2026-0002',
      originalInvoiceDate: new Date('2026-11-01T10:00:00.000Z'),
      reason: 'Full cancellation',
      creditDate: new Date('2026-11-02T10:00:00.000Z'),
      isFullCredit: true,
      lineSnapshots: originalItems.map(toCreditLine),
      committedAt: new Date('2026-11-02T10:00:00.000Z'),
    });

    expect(full.total_net).toBe('30.06');
    expect(full.total_tax).toBe('6.01');
    expect(full.total_gross).toBe('36.07');
    expect(full.tax_breakdown).toEqual([
      { rate: '20.00', net: '30.06', tax: '6.01', gross: '36.07' },
    ]);

    // Partial credit of 2 lines (20.04 * 20% = 4.008 -> 4.01)
    const partial = buildCreditNoteSnapshot({
      originalSnapshot: perRateOriginal,
      originalInvoiceId: 'inv-new',
      originalInvoiceNumber: 'RE-2026-0002',
      originalInvoiceDate: new Date('2026-11-01T10:00:00.000Z'),
      reason: 'Partial return',
      creditDate: new Date('2026-11-02T10:00:00.000Z'),
      isFullCredit: false,
      lineSnapshots: originalItems.slice(0, 2).map(toCreditLine),
      committedAt: new Date('2026-11-02T10:00:00.000Z'),
    });

    expect(partial.total_net).toBe('20.04');
    expect(partial.total_tax).toBe('4.01');
    expect(partial.total_gross).toBe('24.05');
    expect(partial.tax_breakdown).toEqual([
      { rate: '20.00', net: '20.04', tax: '4.01', gross: '24.05' },
    ]);
  });

  it('AUT-1087: second partial credit (isFullCredit: false) that completes a rate bucket consumes remaining VAT cents via priorCreditTaxBuckets', () => {
    const items20 = ['l1', 'l2', 'l3'].map((id) => ({
      id,
      description: 'Part 20%',
      quantity: '1.000',
      unit_price: '10.01',
      tax_rate: '20.00',
      line_discount_type: null,
      line_discount_value: null,
      net: '10.01',
      tax: '2.00',
      gross: '12.01',
      revenue_group_name: 'Parts',
      accounting_allocation: {},
    }));
    const item10 = {
      id: 'l4',
      description: 'Part 10%',
      quantity: '1.000',
      unit_price: '10.00',
      tax_rate: '10.00',
      line_discount_type: null,
      line_discount_value: null,
      net: '10.00',
      tax: '1.00',
      gross: '11.00',
      revenue_group_name: 'Parts',
      accounting_allocation: {},
    };
    const originalWithTwoRates = {
      ...snapshot,
      items: [...items20, item10],
      tax_breakdown: [
        { rate: '10.00', net: '10.00', tax: '1.00', gross: '11.00' },
        { rate: '20.00', net: '30.03', tax: '6.01', gross: '36.04' },
      ],
      total_net: '40.03',
      total_tax: '7.01',
      total_gross: '47.04',
    } as unknown as Parameters<
      typeof buildCreditNoteSnapshot
    >[0]['originalSnapshot'];

    const toCreditLine = (item: (typeof items20)[number]) => ({
      original_item_id: item.id,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      line_discount_type: null,
      line_discount_value: null,
      net: item.net,
      tax: item.tax,
      gross: item.gross,
      tax_rate: item.tax_rate,
      revenue_group_name: item.revenue_group_name,
      accounting_allocation: {},
    });

    // First partial: 2 x 10.01 at 20% -> halfUp(20.02 * 20%) = 4.00
    const firstPartial = buildCreditNoteSnapshot({
      originalSnapshot: originalWithTwoRates,
      originalInvoiceId: 'inv-multi',
      originalInvoiceNumber: 'RE-2026-0003',
      originalInvoiceDate: new Date('2026-11-01T10:00:00.000Z'),
      reason: 'First partial return',
      creditDate: new Date('2026-11-02T10:00:00.000Z'),
      isFullCredit: false,
      lineSnapshots: items20.slice(0, 2).map(toCreditLine),
      committedAt: new Date('2026-11-02T10:00:00.000Z'),
    });
    expect(firstPartial.tax_breakdown).toEqual([
      { rate: '20.00', net: '20.02', tax: '4.00', gross: '24.02' },
    ]);

    // Second partial (isFullCredit: false because 10% item remains): last 1 x 10.01 at 20%
    // halfUp(10.01 * 20%) = 2.00 < remainingTax 2.01, but cumulative 20% net = 30.03 == original 30.03 -> 2.01
    const secondPartial = buildCreditNoteSnapshot({
      originalSnapshot: originalWithTwoRates,
      originalInvoiceId: 'inv-multi',
      originalInvoiceNumber: 'RE-2026-0003',
      originalInvoiceDate: new Date('2026-11-01T10:00:00.000Z'),
      reason: 'Second partial completes 20% bucket',
      creditDate: new Date('2026-11-03T10:00:00.000Z'),
      isFullCredit: false,
      lineSnapshots: [toCreditLine(items20[2])],
      committedAt: new Date('2026-11-03T10:00:00.000Z'),
      priorCreditTaxBuckets: firstPartial.tax_breakdown,
    });
    expect(secondPartial.total_net).toBe('10.01');
    expect(secondPartial.total_tax).toBe('2.01');
    expect(secondPartial.total_gross).toBe('12.02');
    expect(secondPartial.tax_breakdown).toEqual([
      { rate: '20.00', net: '10.01', tax: '2.01', gross: '12.02' },
    ]);
  });
});
