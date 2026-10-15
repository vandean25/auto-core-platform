import { readFileSync } from 'node:fs';
import { BMD_MTF_PUBLIC_FIELD_NAMES } from './bmd-format.constants.js';
import { buildBmdAllocationRules } from './accounting-export-allocation-rules.js';
import { collectBlockersForInvoice } from './accounting-export-candidates.js';
import {
  buildBmdNtcsBookingFields,
  serializeBmdNtcsImport,
} from './bmd-ntcs-import.serializer.js';
import {
  BMD_MTF_EVIDENCED_CREATED_AT,
  BMD_MTF_EVIDENCED_DATE_FROM,
  BMD_MTF_EVIDENCED_DATE_TO,
  bmdMtfEvidencedProfile,
  bmdMtfEvidencedRows,
} from './fixtures/bmd-mtf-evidenced.fixture.js';
import {
  BMD_SAMPLE_CREATED_AT,
  BMD_SAMPLE_DATE_FROM,
  BMD_SAMPLE_DATE_TO,
  bmdSampleProfile,
  bmdSampleRows,
} from './fixtures/bmd-sample-export.fixture.js';

const SYNTHETIC_SHA256 =
  'a342e63d5d3d5d473257667b7bddab05c2a3d36017b97deb2e06ff4c9e78d67d';

const MTF_EVIDENCED_SHA256 =
  'f77f7d7764957d9c0e8892074db76872a61711d194e4c8f007e3904cc0f9e8ee';

const steuercodes = { vat20: '5020', vat13: '5013', vat10: '5010' };

/** Margin-scheme invoice with one line, as a finalized v2 invoice would present it. */
function marginSchemeInvoiceFixture() {
  const allocation = {
    profileCode: 'ACP-BMD-AT-EUR-1',
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
    profileCode: 'ACP-BMD-AT-EUR-1',
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

function serializeSample(rows: typeof bmdSampleRows) {
  return serializeBmdNtcsImport({
    profile: bmdSampleProfile,
    dateFrom: BMD_SAMPLE_DATE_FROM,
    dateTo: BMD_SAMPLE_DATE_TO,
    createdAt: BMD_SAMPLE_CREATED_AT,
    rows,
  });
}

function serializeMtfEvidenced(rows: typeof bmdMtfEvidencedRows) {
  return serializeBmdNtcsImport({
    profile: bmdMtfEvidencedProfile,
    dateFrom: BMD_MTF_EVIDENCED_DATE_FROM,
    dateTo: BMD_MTF_EVIDENCED_DATE_TO,
    createdAt: BMD_MTF_EVIDENCED_CREATED_AT,
    rows,
  });
}

describe('bmd-ntcs-import golden files', () => {
  const publicMtfHeader = readFileSync(
    new URL('./fixtures/bmd-mtf-public-header.reference.txt', import.meta.url),
    'utf8',
  ).trimEnd();

  it('writes booking columns in the public S3 MTF order produced by the serializer', () => {
    expect(BMD_MTF_PUBLIC_FIELD_NAMES.join(';')).toBe(publicMtfHeader);

    const fields = buildBmdNtcsBookingFields(
      bmdMtfEvidencedRows[0],
      steuercodes,
    );
    const record = serializeMtfEvidenced([bmdMtfEvidencedRows[0]])
      .csvText.replace(/\r\n$/, '');

    expect(fields.join(';')).toBe(record);
    expect(fields[BMD_MTF_PUBLIC_FIELD_NAMES.indexOf('Steuercode')]).toBe(
      '5020',
    );
    expect(
      fields[BMD_MTF_PUBLIC_FIELD_NAMES.indexOf('Sollhabenkennzeichen')],
    ).toBe('S');
  });

  describe('synthetic sample (hand-authored before serializer, AUT-351)', () => {
    const committed = readFileSync(
      new URL('./fixtures/bmd-sample-export.csv', import.meta.url),
    );
    const committedLines = committed.toString('ascii').split('\r\n');

    it('pins the committed synthetic sample: standard invoices and a partial credit', () => {
      const result = serializeSample(bmdSampleRows);

      expect(result.bytes.equals(committed)).toBe(true);
      expect(result.sha256).toBe(SYNTHETIC_SHA256);
      expect(result.rowCount).toBe(5);
    });

    it('pins the standard invoice record for 20, 13 and 10 percent', () => {
      expect(serializeSample([bmdSampleRows[0]]).csvText).toBe(
        `${committedLines[0]}\r\n`,
      );
      expect(serializeSample([bmdSampleRows[1]]).csvText).toBe(
        `${committedLines[1]}\r\n`,
      );
      expect(serializeSample([bmdSampleRows[2]]).csvText).toBe(
        `${committedLines[2]}\r\n`,
      );
    });

    it('pins the credit note record: H, positive gross, original invoice as OP-Nummer', () => {
      expect(committedLines[4]).toBe(
        '20.01.2026;20.01.2026;"CN-2026-0001";"2000";"8300";22,60;H;5013;"CN CN-2026-0001 / RE RE-2026-0001";;"RE-2026-0001"',
      );
      expect(serializeSample([bmdSampleRows[4]]).csvText).toBe(
        `${committedLines[4]}\r\n`,
      );
    });
  });

  describe('format-evidenced MTF pilot export (AUT-520, source S3)', () => {
    const committed = readFileSync(
      new URL('./fixtures/bmd-mtf-evidenced-export.csv', import.meta.url),
    );
    const committedLines = committed.toString('ascii').split('\r\n');

    it('pins the pilot-customer bytes for mixed 20/13/10 % and a partial credit', () => {
      const result = serializeMtfEvidenced(bmdMtfEvidencedRows);

      expect(result.bytes.equals(committed)).toBe(true);
      expect(result.sha256).toBe(MTF_EVIDENCED_SHA256);
      expect(result.rowCount).toBe(4);
    });

    it('pins each evidenced line independently of the serializer field builder', () => {
      expect(committedLines[0]).toBe(
        '10.02.2026;10.02.2026;"RE-PILOT-2026-0001";"2000";"8400";120,00;S;5020;"RE RE-PILOT-2026-0001";;"RE-PILOT-2026-0001"',
      );
      expect(committedLines[3]).toBe(
        '20.02.2026;20.02.2026;"CN-PILOT-2026-0001";"2000";"8300";22,60;H;5013;"CN CN-PILOT-2026-0001 / RE RE-PILOT-2026-0001";;"RE-PILOT-2026-0001"',
      );
      expect(serializeMtfEvidenced([bmdMtfEvidencedRows[3]]).csvText).toBe(
        `${committedLines[3]}\r\n`,
      );
    });
  });

  describe('documented export blockers (no BMD vendor acceptance claimed)', () => {
    it('pins the margin-scheme outcome: blocked, so no rows are produced', () => {
      const blockers = collectBlockersForInvoice(
        marginSchemeInvoiceFixture(),
        buildBmdAllocationRules(steuercodes),
      );
      const golden = JSON.parse(
        readFileSync(
          new URL(
            './fixtures/bmd-margin-scheme-blockers.golden.json',
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
        buildBmdAllocationRules(steuercodes),
      );
      const golden = JSON.parse(
        readFileSync(
          new URL(
            './fixtures/bmd-zero-rate-blockers.golden.json',
            import.meta.url,
          ),
          'utf8',
        ),
      );

      expect(blockers).toEqual(golden);
    });
  });
});
