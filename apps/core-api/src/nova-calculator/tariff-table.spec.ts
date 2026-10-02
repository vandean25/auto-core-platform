import { NOVA_TARIFF_TABLE } from './tariff-table.js';
import type { NovaVehicleClass } from './types.js';

const CLASSES: NovaVehicleClass[] = [
  'passenger_z3',
  'n1_legacy_z6',
  'motorcycle_z1_z2',
];

function dayAfter(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

describe('NOVA_TARIFF_TABLE', () => {
  it.each(CLASSES)('has contiguous non-overlapping rows for %s', (vClass) => {
    const rows = NOVA_TARIFF_TABLE
      .filter((r) => r.vehicle_class === vClass)
      .sort((a, b) => a.valid_from.localeCompare(b.valid_from));
    expect(rows.length).toBeGreaterThan(0);

    for (let i = 0; i < rows.length; i++) {
      expect(rows[i].valid_from <= rows[i].valid_to).toBe(true);
      if (i > 0) {
        const prev = rows[i - 1];
        const curr = rows[i];
        expect(curr.valid_from).toBe(dayAfter(prev.valid_to));
      }
    }
  });
});
