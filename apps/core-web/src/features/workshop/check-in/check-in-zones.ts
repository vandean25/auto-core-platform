/** Stable zone ids (sketch_version:1); labels come from i18n. */
export const CHECK_IN_ZONE_IDS = [
  'FRONT_BUMPER',
  'BONNET',
  'WINDSCREEN',
  'ROOF',
  'REAR_WINDOW',
  'BOOT',
  'REAR_BUMPER',
  'LEFT_FRONT_WING',
  'LEFT_FRONT_DOOR',
  'LEFT_REAR_DOOR',
  'LEFT_REAR_WING',
  'RIGHT_FRONT_WING',
  'RIGHT_FRONT_DOOR',
  'RIGHT_REAR_DOOR',
  'RIGHT_REAR_WING',
  'LEFT_FRONT_WHEEL',
  'LEFT_REAR_WHEEL',
  'RIGHT_FRONT_WHEEL',
  'RIGHT_REAR_WHEEL',
  'OTHER',
] as const

export type CheckInZoneId = (typeof CHECK_IN_ZONE_IDS)[number]

export const CHECK_IN_DAMAGE_TYPES = [
  'SCRATCH',
  'DENT',
  'CRACK',
  'OTHER',
] as const

export type CheckInDamageType = (typeof CHECK_IN_DAMAGE_TYPES)[number]

export const CHECK_IN_TYRE_SEASONS = [
  'SUMMER',
  'WINTER',
  'ALL_SEASON',
  'UNKNOWN',
] as const

export type CheckInTyreSeason = (typeof CHECK_IN_TYRE_SEASONS)[number]
