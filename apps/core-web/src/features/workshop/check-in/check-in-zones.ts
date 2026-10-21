export {
  CHECK_IN_ZONE_IDS,
  type CheckInZoneId,
  CHECK_IN_DAMAGE_TYPE_VALUES as CHECK_IN_DAMAGE_TYPES,
  type CheckInDamageType,
} from '../../../../../core-api/src/workshop/workshop-check-in-zones.ts'

export const CHECK_IN_TYRE_SEASONS = [
  'SUMMER',
  'WINTER',
  'ALL_SEASON',
  'UNKNOWN',
] as const

export type CheckInTyreSeason = (typeof CHECK_IN_TYRE_SEASONS)[number]
