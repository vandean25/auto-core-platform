import { readFileSync } from 'node:fs';
import {
  RZL_SAMPLE_CREATED_AT,
  RZL_SAMPLE_DATE_FROM,
  RZL_SAMPLE_DATE_TO,
  rzlSampleProfile,
  rzlSampleRows,
} from './fixtures/rzl-sample-export.fixture.js';
import { serializeRzlFibuImport } from './rzl-fibu-import.serializer.js';

function cents(amount: string): number {
  return Math.round(Number.parseFloat(amount.replace(',', '.')) * 100);
}

function signedCentsByCode(csvText: string): Map<string, number> {
  const totals = new Map<string, number>();
  for (const line of csvText.split('\r\n')) {
    if (!line.startsWith('B;')) {
      continue;
    }
    const fields = line.split(';');
    const [, , , , polarity, amount, , , code] = fields;
    const signed = cents(amount) * (polarity === 'H' ? -1 : 1);
    totals.set(code, (totals.get(code) ?? 0) + signed);
  }
  return totals;
}

describe('committed RZL sample export', () => {
  const result = serializeRzlFibuImport({
    profile: rzlSampleProfile,
    dateFrom: RZL_SAMPLE_DATE_FROM,
    dateTo: RZL_SAMPLE_DATE_TO,
    createdAt: RZL_SAMPLE_CREATED_AT,
    rows: rzlSampleRows,
  });

  it('matches the committed fixture byte for byte', () => {
    const committed = readFileSync(
      new URL('./fixtures/rzl-sample-export.csv', import.meta.url),
    );
    expect(result.bytes.equals(committed)).toBe(true);
    expect(result.sha256).toBe(
      '97f49ca328f7e7c4fd208fa0e2b9900969293a0bfc385a903263b814a4795b54',
    );
  });

  it('reconciles gross per Steuercode with the frozen net and tax facts', () => {
    const grossByCode = signedCentsByCode(result.csvText);
    const frozenByRate = new Map<string, { net: number; tax: number }>();
    for (const row of rzlSampleRows) {
      const rate = Number(row.taxRate).toFixed(2);
      const sign = row.polarity === 'H' ? -1 : 1;
      const current = frozenByRate.get(rate) ?? { net: 0, tax: 0 };
      frozenByRate.set(rate, {
        net: current.net + sign * cents(row.net),
        tax: current.tax + sign * cents(row.tax),
      });
    }

    const steuercodeByRate: Record<string, string> = {
      '20.00': '20',
      '13.00': '13',
      '10.00': '10',
    };
    for (const [rate, { net, tax }] of frozenByRate) {
      const code = steuercodeByRate[rate];
      expect(grossByCode.get(code)).toBe(net + tax);
    }
    expect(grossByCode.get('20')).toBe(36000);
    expect(grossByCode.get('13')).toBe(3390);
    expect(grossByCode.get('10')).toBe(3300);
  });
});
