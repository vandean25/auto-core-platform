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

export interface CatalogSeedItemData {
  sku: string;
  name: string;
  cost_price: number;
  retail_price: number;
  ean: string;
}

export interface FixtureBreakdownCounts {
  updatesExpected: number;
  unchangedExpected: number;
  unmatchedExpected: number;
  priceJumpsExpected: number;
  errorsExpected: number;
  totalRows: number;
}

export const FIXTURE_COUNTS: FixtureBreakdownCounts = {
  updatesExpected: 2500,
  unchangedExpected: 1000,
  unmatchedExpected: 1000,
  priceJumpsExpected: 400,
  errorsExpected: 100,
  totalRows: 5000,
};

/**
 * Generates the catalog items to seed before running the 5,000-row benchmark.
 * Total seeded: 2,500 (updates) + 1,000 (unchanged) + 400 (price jumps) = 3,900 items.
 */
export function generateCatalogSeedItems(tenantId: string): Array<{
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

  // 1. 2,500 items for cost updates (initial cost 10.00, retail 15.00)
  for (let i = 1; i <= FIXTURE_COUNTS.updatesExpected; i++) {
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

  // 2. 1,000 items for unchanged prices (cost 20.00, retail 30.00)
  for (let i = 1; i <= FIXTURE_COUNTS.unchangedExpected; i++) {
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

  // 3. 400 items for price jump tests (initial cost 10.00, retail 15.00)
  for (let i = 1; i <= FIXTURE_COUNTS.priceJumpsExpected; i++) {
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
 * Generates 5,000 CSV rows matching the breakdown:
 * - 2,500 rows matching existing catalog items with cost updates (10.00 -> 11.00, +10%)
 * - 1,000 rows matching existing catalog items with unchanged prices (20.00 -> 20.00)
 * - 1,000 rows unmatched (new items, not in catalog)
 * - 400 rows with price jump > 20% (10.00 -> 25.00, +150%)
 * - 100 rows with deliberate formatting errors (50 empty article no, 50 invalid cost)
 * Total: 5,000 rows.
 */
export function generateSupplierPriceList5000Rows(): string[][] {
  const rows: string[][] = [];

  // Group 1: 2,500 rows matching existing items (cost update 11.00)
  for (let i = 1; i <= FIXTURE_COUNTS.updatesExpected; i++) {
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

  // Group 2: 1,000 rows matching existing items with unchanged price (20.00)
  for (let i = 1; i <= FIXTURE_COUNTS.unchangedExpected; i++) {
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

  // Group 3: 1,000 rows unmatched (new items, e.g. ADV-NEW-XXXXX)
  for (let i = 1; i <= FIXTURE_COUNTS.unmatchedExpected; i++) {
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

  // Group 4: 400 rows with price jump > 20% (cost 10.00 -> 25.00)
  for (let i = 1; i <= FIXTURE_COUNTS.priceJumpsExpected; i++) {
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

  // Group 5: 100 rows with deliberate formatting errors
  // 50 missing supplier article no
  for (let i = 1; i <= 50; i++) {
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
  // 50 invalid cost price (non-numeric)
  for (let i = 51; i <= 100; i++) {
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
 * Serializes the 5,000 rows into CSV buffer.
 */
export function generateSupplierPriceList5000CsvBuffer(
  delimiter: ';' | ',' = ';',
): Buffer {
  const rows = generateSupplierPriceList5000Rows();
  const csvString = serializeCsv(SUPPLIER_CSV_HEADERS, rows, delimiter);
  return Buffer.from(csvString, 'utf8');
}
