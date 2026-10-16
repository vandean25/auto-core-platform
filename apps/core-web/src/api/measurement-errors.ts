import { getErrorBody } from '@/lib/error-utils'

const CODE_MESSAGES: Record<string, string> = {
  NOT_CONFIGURED: 'Bremsen-Messgerät ist nicht konfiguriert.',
  UNSUPPORTED_SCHEMA_VERSION: 'Natives Messformat wird nicht unterstützt.',
  UNSUPPORTED_UNIT: 'Messeinheit wird nicht unterstützt.',
  VEHICLE_IDENTITY_MISMATCH: 'Fahrzeug- oder Auftragsbezug stimmt nicht.',
  DEVICE_BINDING_MISMATCH: 'Gerätebindung stimmt nicht.',
  IMPLAUSIBLE_MEASUREMENT: 'Messwerte liegen außerhalb des Gerätebereichs.',
  MEASUREMENT_CONFLICT: 'Messidentität steht im Konflikt mit vorhandenen Daten.',
  REVIEW_REQUIRED: 'Vorschau ist veraltet — bitte erneut prüfen.',
}

export function describeMeasurementError(error: unknown): string {
  const body = getErrorBody(error)
  const code =
    body?.code ??
    (error instanceof Error && CODE_MESSAGES[error.message]
      ? error.message
      : undefined)
  if (code && CODE_MESSAGES[code]) {
    return CODE_MESSAGES[code]
  }
  return 'Bremsmessung konnte nicht verarbeitet werden. Bitte erneut versuchen.'
}
