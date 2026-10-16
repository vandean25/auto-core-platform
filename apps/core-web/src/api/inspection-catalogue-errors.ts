import { getErrorBody } from '@/lib/error-utils'

export const INSPECTION_CATALOGUE_ERROR_MESSAGES: Record<string, string> = {
  NOT_CONFIGURED:
    'Der offizielle Katalog ist für diesen Mandanten noch nicht freigeschaltet.',
  UNKNOWN_CODE: 'Der gewählte Katalogcode ist unbekannt.',
  STALE_CATALOG:
    'Die Katalogversion ist veraltet und muss erneut geprüft werden.',
  OUT_OF_SCOPE:
    'Für dieses Fahrzeug liegt kein nachgewiesener Anwendungsbereich vor.',
  SOURCE_CONFLICT:
    'Mehrere Katalogversionen überschneiden sich. Manuelle Klärung erforderlich.',
  REVIEW_REQUIRED:
    'Die Vorschau ist abgelaufen oder hat sich geändert. Bitte erneut prüfen.',
  UNSUPPORTED_SCHEMA_VERSION:
    'Das Katalogformat wird nicht unterstützt.',
}

export function describeInspectionCatalogueError(error: unknown): string {
  const body = getErrorBody(error)
  const code = body?.code
  if (code && INSPECTION_CATALOGUE_ERROR_MESSAGES[code]) {
    return INSPECTION_CATALOGUE_ERROR_MESSAGES[code]
  }
  return 'Die Katalogreferenz konnte nicht verarbeitet werden. Bitte erneut versuchen.'
}
