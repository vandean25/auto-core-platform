import { readFileSync } from 'node:fs';
import { buildBmdAllocationRules } from './accounting-export-allocation-rules.js';
import { collectBlockersForInvoice } from './accounting-export-candidates.js';
import { serializeBmdNtcsImport } from './bmd-ntcs-import.serializer.js';
import {
  BMD_SAMPLE_CREATED_AT,
  BMD_SAMPLE_DATE_FROM,
  BMD_SAMPLE_DATE_TO,
  bmdSampleProfile,
  bmdSampleRows,
} from './fixtures/bmd-sample-export.fixture.js';

const SAMPLE_SHA256 =
  'a342e63d5d3d5d473257667b7bddab05c2a3d36017b97deb2e06ff4c9e78d67d';

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

function serializeSample(rows: typeof bmdSampleRows) {
  return serializeBmdNtcsImport({
    profile: bmdSampleProfile,
    dateFrom: BMD_SAMPLE_DATE_FROM,
    dateTo: BMD_SAMPLE_DATE_TO,
    createdAt: BMD_SAMPLE_CREATED_AT,
    rows,
  });
}

describe('bmd-ntcs-import golden files', () => {
  const committed = readFileSync(
    new URL('./fixtures/bmd-sample-export.csv', import.meta.url),
  );
  const committedLines = committed.toString('ascii').split('\r\n');

  it('pins the committed synthetic sample: standard invoices and a partial credit', () => {
    const result = serializeSample(bmdSampleRows);

    expect(result.bytes.equals(committed)).toBe(true);
    expect(result.sha256).toBe(SAMPLE_SHA256);
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

  it('pins the margin-scheme outcome: blocked by the documented blockers, so no rows are produced', () => {
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
});
