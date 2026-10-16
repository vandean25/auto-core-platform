import { getErrorBody } from '@/lib/error-utils'

export const INSPECTION_IMPORT_ERROR_MESSAGES: Record<string, string> = {
  EXCHANGE_NOT_CONFIGURED:
    'Der externe Begutachtungsimport ist für diesen Standort nicht konfiguriert.',
  STATION_MISMATCH:
    'Die Prüfstellen- oder Kontobindung passt nicht zum ausgewählten Anschluss.',
  VEHICLE_IDENTITY_MISMATCH:
    'Die Fahrzeugdaten stimmen nicht mit dem externen Ergebnis überein.',
  RESULT_UNCONFIRMED:
    'Das Ergebnis ist nicht bestätigt und kann nicht übernommen werden.',
  EXTERNAL_RESULT_CONFLICT:
    'Das externe Ergebnis widerspricht bereits gespeicherten Daten.',
  REVIEW_REQUIRED:
    'Die Vorschau ist abgelaufen oder hat sich geändert. Bitte erneut prüfen.',
  PROVIDER_READ_FAILED:
    'Das externe System konnte nicht gelesen werden. Bitte später erneut versuchen.',
}

export function describeInspectionImportError(error: unknown): string {
  const body = getErrorBody(error)
  const code =
    body?.code ??
    (error instanceof Error && INSPECTION_IMPORT_ERROR_MESSAGES[error.message]
      ? error.message
      : undefined)
  if (code && INSPECTION_IMPORT_ERROR_MESSAGES[code]) {
    return INSPECTION_IMPORT_ERROR_MESSAGES[code]
  }
  return 'Der Begutachtungsimport ist fehlgeschlagen. Bitte erneut versuchen.'
}
