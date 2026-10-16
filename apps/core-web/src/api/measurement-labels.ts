export const MEASUREMENT_IMPORT_STATE_LABELS: Record<string, string> = {
  RECEIVED: 'Empfangen',
  REJECTED: 'Abgelehnt',
  QUARANTINED: 'Quarantäne',
  READY_FOR_REVIEW: 'Bereit zur Übernahme',
  APPLIED: 'Übernommen',
}

export const MEASUREMENT_QUARANTINE_LABELS: Record<string, string> = {
  STALE_MEASUREMENT: 'Messung älter als 24 Stunden',
  UNCONFIRMED_DEVICE: 'Gerätenachweis unbestätigt oder abgelaufen',
  PARTIAL_FINALITY: 'Ergebnis ist nicht endgültig',
}

export const MEASUREMENT_WHEEL_SIDE_LABELS: Record<string, string> = {
  LEFT: 'links',
  RIGHT: 'rechts',
}
