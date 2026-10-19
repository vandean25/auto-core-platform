import {
  formatMoneyFromCents,
  lineMoneyCentsFromQtyAndUnit,
} from './migration-money.util.js';
import {
  parseCanonicalMigrationCsv,
  rowToCanonicalRecord,
} from './migration-csv-parse.util.js';

export function computeMigrationStockValue(
  parsed: ReturnType<typeof parseCanonicalMigrationCsv>,
): string {
  let totalCents = 0n;
  const headers = parsed.headers;
  for (const row of parsed.rows) {
    const record = rowToCanonicalRecord(headers, row);
    const quantity = record.quantity ?? '';
    const unitCost = record.unit_cost ?? '';
    if (quantity.length === 0 || unitCost.length === 0) {
      continue;
    }
    try {
      totalCents += lineMoneyCentsFromQtyAndUnit(quantity, unitCost);
    } catch {
      continue;
    }
  }
  return formatMoneyFromCents(totalCents);
}
