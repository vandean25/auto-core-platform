import type {
  CheckInDamageMarker,
  CheckInCondition,
  WorkshopCheckIn,
  UpdateWorkshopCheckInPayload,
} from '@/api/workshop-check-in'
import type { CheckInTyreSeason } from './check-in-zones'
import { CHECK_IN_TYRE_SEASONS } from './check-in-zones'

export type CheckInDraftSnapshot = {
  odometer: number
  fuel_level: number
  items_left: string
  key_count: number
  warning_lights: string[]
  condition: CheckInCondition
  damage_markers: CheckInDamageMarker[]
}

function parseTyreSeason(value: unknown): CheckInTyreSeason {
  if (
    typeof value === 'string' &&
    (CHECK_IN_TYRE_SEASONS as readonly string[]).includes(value)
  ) {
    return value as CheckInTyreSeason
  }
  return 'UNKNOWN'
}

export function draftFromCheckIn(record: WorkshopCheckIn): CheckInDraftSnapshot {
  const raw = record.condition_json as Record<string, unknown>
  return {
    odometer: record.odometer,
    fuel_level: record.fuel_level,
    items_left: record.items_left ?? '',
    key_count: record.key_count ?? 0,
    warning_lights: record.warning_lights ?? [],
    condition: {
      tyre_season: parseTyreSeason(raw.tyre_season),
      exterior_notes: typeof raw.exterior_notes === 'string' ? raw.exterior_notes : '',
      interior_notes: typeof raw.interior_notes === 'string' ? raw.interior_notes : '',
    },
    damage_markers: (record.damage_markers_json as CheckInDamageMarker[]) ?? [],
  }
}

export function buildUpdatePayload(
  revision: number,
  snapshot: CheckInDraftSnapshot,
): UpdateWorkshopCheckInPayload {
  return {
    expected_revision: revision,
    odometer: snapshot.odometer,
    fuel_level: snapshot.fuel_level,
    items_left: snapshot.items_left,
    key_count: snapshot.key_count,
    warning_lights: snapshot.warning_lights,
    condition: snapshot.condition,
    damage_markers: snapshot.damage_markers,
  }
}

export function snapshotsEqual(
  left: CheckInDraftSnapshot,
  right: CheckInDraftSnapshot,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
