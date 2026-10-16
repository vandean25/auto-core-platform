import type { Prisma } from '@prisma/client';

export const DEFAULT_CHECK_IN_CONDITION_JSON: Prisma.JsonObject = {
  schema_version: 1,
  tyre_season: 'UNKNOWN',
  exterior_notes: '',
  interior_notes: '',
};

export const EMPTY_DAMAGE_MARKERS_JSON: Prisma.JsonArray = [];
