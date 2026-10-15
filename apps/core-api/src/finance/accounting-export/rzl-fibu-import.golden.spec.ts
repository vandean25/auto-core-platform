import { readFileSync } from 'node:fs';
import type { AccountingExportBookingRow } from './accounting-export.types.js';
import { buildRzlAllocationRules } from './accounting-export-allocation-rules.js';
import { collectBlockersForInvoice } from './accounting-export-candidates.js';
import {
  RZL_DRAFT_EVIDENCED_CREATED_AT,
  RZL_DRAFT_EVIDENCED_DATE_FROM,
  RZL_DRAFT_EVIDENCED_DATE_TO,
  rzlDraftEvidencedProfile,
  rzlDraftEvidencedRows,
} from './fixtures/rzl-draft-evidenced.fixture.js';
import {
  RZL_GOLDEN_CREATED_AT,
  RZL_GOLDEN_DATE_FROM,
  RZL_GOLDEN_DATE_TO,
  rzlGoldenMixedRows,
  rzlGoldenProfile,
  rzlGoldenRate10Rows,
  rzlGoldenRate13Rows,
  rzlGoldenRate20Rows,
} from './fixtures/rzl-golden-scenarios.fixture.js';
import {
  RZL_SAMPLE_CREATED_AT,
  RZL_SAMPLE_DATE_FROM,
  RZL_SAMPLE_DATE_TO,
  rzlSampleProfile,
  rzlSampleRows,
} from './fixtures/rzl-sample-export.fixture.js';
import {
  RZL_BOOKING_COLUMNS,
  RZL_FIBU_EURO_PUBLIC_FIELD_NAMES,
} from './rzl-format.constants.js';
import {
  buildRzlFibuImportBookingFields,
  serializeRzlFibuImport,
} from './rzl-fibu-import.serializer.js';

const SYNTHETIC_SAMPLE_SHA256 =
  '97f49ca328f7e7c4fd208fa0e2b9900969293a0bfc385a903263b814a4795b54';

const DRAFT_EVIDENCED_SHA256 =
  '7a1f09ab999f084d52a438e00840432e01ea524c1038cfe1a4e2d523b1d41ad5';

const steuercodes = { vat20: '20', vat13: '13', vat10: '10' };

function serializeSample(rows: typeof rzlSampleRows) {
  return serializeRzlFibuImport({
    profile: rzlSampleProfile,
    dateFrom: RZL_SAMPLE_DATE_FROM,
    dateTo: RZL_SAMPLE_DATE_TO,
    createdAt: RZL_SAMPLE_CREATED_AT,
    rows,
  });
}

function serializeGolden(rows: AccountingExportBookingRow[]) {
  return serializeRzlFibuImport({
    profile: rzlGoldenProfile,
    dateFrom: RZL_GOLDEN_DATE_FROM,
    dateTo: RZL_GOLDEN_DATE_TO,
    createdAt: RZL_GOLDEN_CREATED_AT,
    rows,
  });
}

function serializeDraftEvidenced(rows: typeof rzlDraftEvidencedRows) {
  return serializeRzlFibuImport({
    profile: rzlDraftEvidencedProfile,
    dateFrom: RZL_DRAFT_EVIDENCED_DATE_FROM,
    dateTo: RZL_DRAFT_EVIDENCED_DATE_TO,
    createdAt: RZL_DRAFT_EVIDENCED_CREATED_AT,
    rows,
  });
}

/** Margin-scheme invoice with one line, as a finalized v2 invoice would present it. */
function marginSchemeInvoiceFixture() {
  const allocation = {
    profileCode: 'ACP-RZL-AT-EUR-1',
    profileVersion: 3,
    sourceCategoryKey: 'vehicle_margin',
    sourceCategoryLabel: 'Vehicle margin',
    revenueAccount: '8400',
    debtorAccount: '2000',
    taxMode: 'MARGIN_SCHEME',
    taxRate: '20.00',
    taxTreatment: 'automatic',
    buKey: null,
    countryIso: 'AT',
    currency: 'EUR',
  };

  return {
    id: 'inv-margin-1',
    status: 'FINALIZED' as const,
    invoice_number: 'RE-2026-0003',
    site_id: 'site-1',
    legal_entity_id: 'le-1',
    tax_mode: 'MARGIN_SCHEME' as const,
    snapshot: {
      schema_version: 2,
      document_kind: 'INVOICE',
      site_id: 'site-1',
      legal_entity_id: 'le-1',
      currency: 'EUR',
      seller: { name: 'Seller GmbH' },
      items: [
        {
          id: 'line-margin-1',
          net: '100.00',
          tax: '0.00',
          gross: '120.00',
          accounting_allocation: allocation,
        },
      ],
      tax_breakdown: [],
      total_net: '100.00',
      total_tax: '0.00',
      total_gross: '120.00',
      snapshot_created_at: '2026-01-10T00:00:00.000Z',
      tax_mode: 'MARGIN_SCHEME',
    },
    items: [{ id: 'line-margin-1', accounting_snapshot: allocation }],
  };
}

function zeroRateInvoiceFixture() {
  const allocation = {
    profileCode: 'ACP-RZL-AT-EUR-1',
    profileVersion: 3,
    sourceCategoryKey: 'manual_line',
    sourceCategoryLabel: 'Manual invoice lines',
    revenueAccount: '8400',
    debtorAccount: '2000',
    taxMode: 'STANDARD',
    taxRate: '0.00',
    taxTreatment: 'automatic',
    buKey: null,
    countryIso: 'AT',
    currency: 'EUR',
  };

  return {
    id: 'inv-1',
    status: 'FINALIZED' as const,
    invoice_number: 'RE-2026-0001',
    site_id: 'site-1',
    legal_entity_id: 'le-1',
    tax_mode: 'STANDARD' as const,
    snapshot: {
      schema_version: 2,
      document_kind: 'INVOICE',
      site_id: 'site-1',
      legal_entity_id: 'le-1',
      currency: 'EUR',
      seller: { name: 'Seller GmbH' },
      items: [
        {
          id: 'line-zero',
          net: '50.00',
          tax: '0.00',
          gross: '50.00',
          accounting_allocation: allocation,
        },
      ],
      tax_breakdown: [],
      total_net: '50.00',
      total_tax: '0.00',
      total_gross: '50.00',
      snapshot_created_at: '2026-01-10T00:00:00.000Z',
      tax_mode: 'STANDARD',
    },
    items: [{ id: 'line-zero', accounting_snapshot: allocation }],
  };
}

describe('rzl-fibu-import golden files', () => {
  const publicEuroFields = readFileSync(
    new URL(
      './fixtures/rzl-fibu-euro-public-fields.reference.txt',
      import.meta.url,
    ),
    'utf8',
  ).trimEnd();

  const publicAusgangsrechnung = readFileSync(
    new URL(
      './fixtures/rzl-fibu-public-ausgangsrechnung.reference.txt',
      import.meta.url,
    ),
    'utf8',
  ).trimEnd();

  it('pins the official Euro-Version field order from source S1 (handbook 2.2.1)', () => {
    expect(RZL_FIBU_EURO_PUBLIC_FIELD_NAMES.join(';')).toBe(publicEuroFields);
    expect(RZL_FIBU_EURO_PUBLIC_FIELD_NAMES.length).toBe(41);
  });

  it('reads the handbook Ausgangsrechnung example without using the ACP serializer', () => {
    const fields = publicAusgangsrechnung.split(';');
    expect(
      fields[RZL_FIBU_EURO_PUBLIC_FIELD_NAMES.indexOf('Belegkreis')],
    ).toBe('AR');
    expect(
      fields[RZL_FIBU_EURO_PUBLIC_FIELD_NAMES.indexOf('Buchungsart')],
    ).toBe('1');
    expect(
      fields[RZL_FIBU_EURO_PUBLIC_FIELD_NAMES.indexOf('USt-Schluessel')],
    ).toBe('20');
    expect(
      fields[RZL_FIBU_EURO_PUBLIC_FIELD_NAMES.indexOf('USt-Code')],
    ).toBe('2');
  });

  it('writes ACP draft booking columns in pinned order via the field builder', () => {
    const fields = buildRzlFibuImportBookingFields(
      rzlDraftEvidencedRows[0],
      steuercodes,
    );
    const bookingLine = serializeDraftEvidenced([rzlDraftEvidencedRows[0]])
      .csvText.split('\r\n')
      .find((line) => line.startsWith('B;'));

    expect(bookingLine).toBeDefined();
    expect(fields.join(';')).toBe(bookingLine);
    expect(fields[RZL_BOOKING_COLUMNS.indexOf('BUCHUNGSART')]).toBe('AR');
    expect(fields[RZL_BOOKING_COLUMNS.indexOf('SOLL_HABEN')]).toBe('S');
  });

  describe('synthetic sample (AUT-350 committed fixture)', () => {
    const committed = readFileSync(
      new URL('./fixtures/rzl-sample-export.csv', import.meta.url),
    );

    it('pins the committed synthetic sample byte for byte', () => {
      const result = serializeSample(rzlSampleRows);

      expect(result.bytes.equals(committed)).toBe(true);
      expect(result.sha256).toBe(SYNTHETIC_SAMPLE_SHA256);
      expect(result.rowCount).toBe(5);
    });
  });

  describe('per-rate invoice and credit (committed bytes)', () => {
    it.each([
      {
        rate: '20',
        file: 'rzl-golden-rate-20-invoice-credit.csv',
        rows: rzlGoldenRate20Rows,
        expectedSha256:
          'd9b7869f7cc10e96b8f87feac209759a10125e400db040b66d4152c17f5988c1',
      },
      {
        rate: '13',
        file: 'rzl-golden-rate-13-invoice-credit.csv',
        rows: rzlGoldenRate13Rows,
        expectedSha256:
          'c36b1307f5922f513002d20cad0df401b42f72be8ed81b08cf307924694d0a1f',
      },
      {
        rate: '10',
        file: 'rzl-golden-rate-10-invoice-credit.csv',
        rows: rzlGoldenRate10Rows,
        expectedSha256:
          '5817761d186f6cf84f84bd40845e9384760a85c21fc7c5f498873107c6a53a18',
      },
    ])(
      'pins the $rate % standard invoice and mirrored credit',
      ({ file, rows, expectedSha256 }) => {
        const committed = readFileSync(
          new URL(`./fixtures/${file}`, import.meta.url),
        );
        const result = serializeGolden(rows);

        expect(result.bytes.equals(committed)).toBe(true);
        expect(result.sha256).toBe(expectedSha256);
        expect(result.rowCount).toBe(2);
      },
    );
  });

  describe('mixed invoice and partial credit (committed bytes)', () => {
    const committed = readFileSync(
      new URL(
        './fixtures/rzl-golden-mixed-invoice-partial-credit.csv',
        import.meta.url,
      ),
    );

    it('pins mixed 20 / 13 / 10 % lines and a partial 13 % credit', () => {
      const result = serializeGolden(rzlGoldenMixedRows);

      expect(result.bytes.equals(committed)).toBe(true);
      expect(result.sha256).toBe(
        '5fb0dfba73c062dd6f9ed9ff3c2fccf774cdb452ac8bb4679d6d82fab4860051',
      );
      expect(result.rowCount).toBe(4);
    });
  });

  describe('format-evidenced pilot export (AUT-521, source S1 semantics)', () => {
    const committed = readFileSync(
      new URL('./fixtures/rzl-draft-evidenced-export.csv', import.meta.url),
    );
    const committedLines = committed.toString('latin1').split('\r\n');

    it('pins the pilot-customer bytes for mixed rates and a partial credit', () => {
      const result = serializeDraftEvidenced(rzlDraftEvidencedRows);

      expect(result.bytes.equals(committed)).toBe(true);
      expect(result.sha256).toBe(DRAFT_EVIDENCED_SHA256);
      expect(result.rowCount).toBe(4);
    });

    it('pins the partial credit line independently of the serializer field builder', () => {
      expect(committedLines[5]).toBe(
        'B;AG;20.02.2026;"CN-PILOT-2026-0001";H;22,60;"2000";"8300";13;"CN CN-PILOT-2026-0001 / RE RE-PILOT-2026-0001";"RE-PILOT-2026-0001";M;',
      );
      expect(serializeDraftEvidenced([rzlDraftEvidencedRows[3]]).csvText).toBe(
        [
          'K;"RZL-FIBU-IMPORT-ACP-DRAFT-1";"FN-PILOT";20260228120000;01.02.2026;28.02.2026;"EUR";"UGB";4',
          'C;BUCHUNGSART;BELEGDATUM;BELEGNUMMER;SOLL_HABEN;BETRAG;KONTO;GEGENKONTO;STEUERCODE;BUCHUNGSTEXT;OP_BELEGNUMMER;OP_MODUS;KOSTENSTELLE',
          committedLines[5],
          '',
        ].join('\r\n'),
      );
    });
  });

  describe('documented export blockers (no RZL vendor acceptance claimed)', () => {
    it('pins the margin-scheme outcome: blocked, so no rows are produced', () => {
      const blockers = collectBlockersForInvoice(
        marginSchemeInvoiceFixture(),
        buildRzlAllocationRules(steuercodes),
      );
      const golden = JSON.parse(
        readFileSync(
          new URL(
            './fixtures/rzl-margin-scheme-blockers.golden.json',
            import.meta.url,
          ),
          'utf8',
        ),
      );

      expect(blockers).toEqual(golden);
    });

    it('pins the zero-rate outcome for a non-zero gross line', () => {
      const blockers = collectBlockersForInvoice(
        zeroRateInvoiceFixture(),
        buildRzlAllocationRules(steuercodes),
      );
      const golden = JSON.parse(
        readFileSync(
          new URL('./fixtures/rzl-zero-rate-blockers.golden.json', import.meta.url),
          'utf8',
        ),
      );

      expect(blockers).toEqual(golden);
    });
  });
});
