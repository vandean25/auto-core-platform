import { serializeCsv } from '../../src/import/csv-parse.util.js';

/**
 * Fictitious supplier name strictly for tests and benchmarks.
 * Under NO circumstances should real customer or pilot customer names be used.
 */
export const FIXTURE_SUPPLIER_NAME = 'Autoteile Direktvertrieb GmbH';

export const SUPPLIER_CSV_HEADERS = [
  'Lieferanten-Artikelnummer',
  'EAN',
  'Beschreibung',
  'Marke',
  'Einkaufspreis',
  'UVP',
  'Einheit',
];

export const SUPPLIER_CSV_MAPPING = {
  supplier_article_no: 'Lieferanten-Artikelnummer',
  ean: 'EAN',
  description: 'Beschreibung',
  brand: 'Marke',
  cost_price: 'Einkaufspreis',
  rrp: 'UVP',
  unit: 'Einheit',
};

export interface FixtureBreakdownCounts {
  updatesExpected: number;
  unchangedExpected: number;
  unmatchedExpected: number;
  priceJumpsExpected: number;
  errorsExpected: number;
  totalRows: number;
}

/** 5,000-row breakdown for the nightly performance benchmark. */
export const FIXTURE_COUNTS_LARGE: FixtureBreakdownCounts = {
  updatesExpected: 2500,
  unchangedExpected: 1000,
  unmatchedExpected: 1000,
  priceJumpsExpected: 400,
  errorsExpected: 100,
  totalRows: 5000,
};

/** 200-row breakdown with the same shape, used by the PR e2e suite. */
export const FIXTURE_COUNTS_SMALL: FixtureBreakdownCounts = {
  updatesExpected: 100,
  unchangedExpected: 40,
  unmatchedExpected: 40,
  priceJumpsExpected: 16,
  errorsExpected: 4,
  totalRows: 200,
};

export function expectedDryRunTotals(counts: FixtureBreakdownCounts) {
  return {
    rows: counts.totalRows,
    update: counts.updatesExpected + counts.priceJumpsExpected,
    skip: counts.unchangedExpected + counts.unmatchedExpected,
    create: 0,
    error: counts.errorsExpected,
    flagged_jumps: counts.priceJumpsExpected,
  };
}

/**
 * Generates the catalog items to seed before running an import:
 * updates + unchanged + price-jump items, each with a known starting price.
 */
export function generateCatalogSeedItems(
  tenantId: string,
  counts: FixtureBreakdownCounts,
): Array<{
  tenant_id: string;
  sku: string;
  name: string;
  cost_price: number;
  retail_price: number;
  ean: string;
  unit: string;
}> {
  const items: Array<{
    tenant_id: string;
    sku: string;
    name: string;
    cost_price: number;
    retail_price: number;
    ean: string;
    unit: string;
  }> = [];

  // 1. Items for cost updates (initial cost 10.00, retail 15.00)
  for (let i = 1; i <= counts.updatesExpected; i++) {
    const pad = i.toString().padStart(5, '0');
    items.push({
      tenant_id: tenantId,
      sku: `ADV-UPD-${pad}`,
      name: `Bremsbelagsatz Standard ${pad}`,
      cost_price: 10.0,
      retail_price: 15.0,
      ean: `4012345${pad}`,
      unit: 'pcs',
    });
  }

  // 2. Items for unchanged prices (cost 20.00, retail 30.00)
  for (let i = 1; i <= counts.unchangedExpected; i++) {
    const pad = i.toString().padStart(5, '0');
    items.push({
      tenant_id: tenantId,
      sku: `ADV-UNCH-${pad}`,
      name: `Oelfilter Premium ${pad}`,
      cost_price: 20.0,
      retail_price: 30.0,
      ean: `4023456${pad}`,
      unit: 'pcs',
    });
  }

  // 3. Items for price jump tests (initial cost 10.00, retail 15.00)
  for (let i = 1; i <= counts.priceJumpsExpected; i++) {
    const pad = i.toString().padStart(5, '0');
    items.push({
      tenant_id: tenantId,
      sku: `ADV-JUMP-${pad}`,
      name: `Zahnriemensatz ${pad}`,
      cost_price: 10.0,
      retail_price: 15.0,
      ean: `4045678${pad}`,
      unit: 'pcs',
    });
  }

  return items;
}

/**
 * Generates CSV rows matching the breakdown:
 * - updates rows matching existing catalog items (cost 10.00 -> 11.00, +10%)
 * - unchanged rows matching existing catalog items (20.00 -> 20.00)
 * - unmatched rows (new items, not in catalog)
 * - price jump rows > 20% (cost 10.00 -> 25.00, +150%)
 * - error rows (half empty article no, half invalid cost)
 */
export function generateSupplierPriceListRows(
  counts: FixtureBreakdownCounts,
): string[][] {
  const rows: string[][] = [];

  // Group 1: rows matching existing items (cost update 11.00)
  for (let i = 1; i <= counts.updatesExpected; i++) {
    const pad = i.toString().padStart(5, '0');
    rows.push([
      `ADV-UPD-${pad}`,
      `4012345${pad}`,
      `Bremsbelagsatz Standard ${pad}`,
      'Bosch',
      '11,00',
      '16,50',
      'STK',
    ]);
  }

  // Group 2: rows matching existing items with unchanged price (20.00)
  for (let i = 1; i <= counts.unchangedExpected; i++) {
    const pad = i.toString().padStart(5, '0');
    rows.push([
      `ADV-UNCH-${pad}`,
      `4023456${pad}`,
      `Oelfilter Premium ${pad}`,
      'Mann',
      '20,00',
      '30,00',
      'STK',
    ]);
  }

  // Group 3: rows unmatched (new items, e.g. ADV-NEW-XXXXX)
  for (let i = 1; i <= counts.unmatchedExpected; i++) {
    const pad = i.toString().padStart(5, '0');
    rows.push([
      `ADV-NEW-${pad}`,
      `4034567${pad}`,
      `Luftfilter Neu ${pad}`,
      'Mahle',
      '12,50',
      '18,75',
      'STK',
    ]);
  }

  // Group 4: rows with price jump > 20% (cost 10.00 -> 25.00)
  for (let i = 1; i <= counts.priceJumpsExpected; i++) {
    const pad = i.toString().padStart(5, '0');
    rows.push([
      `ADV-JUMP-${pad}`,
      `4045678${pad}`,
      `Zahnriemensatz ${pad}`,
      'Gates',
      '25,00',
      '35,00',
      'STK',
    ]);
  }

  // Group 5: rows with deliberate formatting errors
  const emptyIdErrors = Math.ceil(counts.errorsExpected / 2);
  // missing supplier article no
  for (let i = 1; i <= emptyIdErrors; i++) {
    const pad = i.toString().padStart(5, '0');
    rows.push([
      '', // empty supplier_article_no
      `4056789${pad}`,
      `Fehlerhafter Artikel Leer-Nummer ${pad}`,
      'Ate',
      '10,00',
      '15,00',
      'STK',
    ]);
  }
  // invalid cost price (non-numeric)
  for (let i = emptyIdErrors + 1; i <= counts.errorsExpected; i++) {
    const pad = i.toString().padStart(5, '0');
    rows.push([
      `ADV-ERR-${pad}`,
      `4067890${pad}`,
      `Fehlerhafter Artikel Ungueltiger-Preis ${pad}`,
      'Ate',
      'INVALID_PRICE', // invalid cost price
      '15,00',
      'STK',
    ]);
  }

  return rows;
}

/**
 * Serializes the generated rows into a CSV buffer.
 */
export function generateSupplierPriceListCsvBuffer(
  counts: FixtureBreakdownCounts,
  delimiter: ';' | ',' = ';',
): Buffer {
  const rows = generateSupplierPriceListRows(counts);
  const csvString = serializeCsv(SUPPLIER_CSV_HEADERS, rows, delimiter);
  return Buffer.from(csvString, 'utf8');
}
