import type { Prisma } from '@prisma/client';
import { tierFilter, type MatchTier } from '../search-ranking.js';
import type { ParsedSearchQuery } from '../search.types.js';

function makeModelWhere(
  tier: MatchTier,
  terms: string[],
): Prisma.VehicleWhereInput {
  return {
    AND: terms.map((term) => ({
      OR: [{ make: tierFilter(tier, term) }, { model: tierFilter(tier, term) }],
    })),
  };
}

/**
 * Vehicle predicate for plate, VIN and make/model input; `null` when the input is not about a vehicle.
 * shortcut: a plate is matched as typed and in its normalised form, so a plate stored with separators is
 * only found when typed the same way (no plate_normalized column); upgrade by adding that column.
 */
export function vehicleMatchWhere(
  query: ParsedSearchQuery,
  tier: MatchTier,
): Prisma.VehicleWhereInput | null {
  if (query.kind === 'uuid') return { id: query.text.toLowerCase() };
  const or: Prisma.VehicleWhereInput[] = [];
  if (query.plate) {
    or.push(
      { plate: tierFilter(tier, query.plate) },
      { plate: tierFilter(tier, query.text) },
      { vin: tierFilter(tier, query.plate) },
    );
  }
  if (query.kind === 'vin') {
    or.push({ vin: tierFilter(tier, query.text) });
  }
  // Model names like "X5" or "Q7" look like plates, so plate-shaped input searches make/model too.
  if (query.kind === 'name' || query.kind === 'plate') {
    or.push(makeModelWhere(tier, query.terms));
  }
  return or.length > 0 ? { OR: or } : null;
}
