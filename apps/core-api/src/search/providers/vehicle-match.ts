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

/** Exact and prefix on the normalised plate; no contains. The index (tenant_id, plate_normalized) narrows to the tenant and serves equality. */
function plateWhere(
  tier: MatchTier,
  plate: string,
): Prisma.VehicleWhereInput | null {
  if (tier === 'contains') return null;
  return {
    plate_normalized:
      tier === 'exact' ? { equals: plate } : { startsWith: plate },
  };
}

/** A VIN fragment of 6+ characters matches as prefix or suffix (exact for a full VIN). */
function vinWhere(tier: MatchTier, vin: string): Prisma.VehicleWhereInput {
  const filter =
    tier === 'contains'
      ? { endsWith: vin, mode: 'insensitive' as const }
      : tierFilter(tier, vin);
  return { vin: filter };
}

/** Vehicle predicate for plate, VIN and make/model input; `null` when the input is not about a vehicle. */
export function vehicleMatchWhere(
  query: ParsedSearchQuery,
  tier: MatchTier,
): Prisma.VehicleWhereInput | null {
  if (query.kind === 'uuid') return { id: query.text.toLowerCase() };
  const or: Prisma.VehicleWhereInput[] = [];
  const plate = query.plate ? plateWhere(tier, query.plate) : null;
  if (plate) or.push(plate);
  if (query.vin) or.push(vinWhere(tier, query.vin));
  // Model names like "X5" or "Q7" look like plates, so plate-shaped input searches make/model too.
  if (query.kind === 'name' || query.kind === 'plate') {
    or.push(makeModelWhere(tier, query.terms));
  }
  return or.length > 0 ? { OR: or } : null;
}
