/**
 * Deterministic EN → DE copy for generated `errors.codes.*` entries.
 * Keeps API paths, codes, and interpolation placeholders intact.
 */

const EXACT = new Map(
  Object.entries({
    'No active site is set for this session. Use GET /api/me/sites then PATCH /api/me/active-site to select a site.':
      'Für diese Sitzung ist kein Standort ausgewählt. Bitte wählen Sie oben einen Standort aus.',
    'Agent policy looser than platform.':
      'Die Agenten-Richtlinie ist lockerer als die Plattformvorgabe.',
    'Agent policy unknown action type.':
      'Unbekannter Aktionstyp in der Agenten-Richtlinie.',
    'Agent policy version conflict.': 'Konflikt der Agenten-Richtlinien-Version.',
    'Letterhead extraction failed.': 'Das Briefpapier konnte nicht ausgelesen werden.',
    'Letterhead extraction timed out.': 'Das Auslesen des Briefpapiers hat zu lange gedauert. Bitte versuchen Sie es erneut.',
    'The letterhead extraction provider is rate limited.':
      'Das Briefpapier kann gerade nicht ausgelesen werden. Bitte versuchen Sie es in einigen Minuten erneut.',
    'Seller identity is incomplete for invoice issuance.':
      'Die Angaben zum Betrieb sind für die Rechnungsstellung unvollständig.',
    'Seller identity is incomplete for the estimate.':
      'Die Angaben zum Betrieb sind für den Kostenvoranschlag unvollständig.',
    'Seller identity is incomplete.':
      'Die Angaben zum Betrieb sind unvollständig.',
    'First registration date is required for shortening.':
      'Für die Verkürzung ist das Datum der Erstzulassung erforderlich.',
    'No rule is configured for contracts before 01/01/2022.':
      'Für Verträge vor dem 01.01.2022 ist keine Regel hinterlegt.',
    'Shortening the statutory warranty period requires a consumer purchase.':
      'Eine Verkürzung der Basisfrist setzt einen Verbraucherkauf voraus.',
    'First registration must be more than one year before handover.':
      'Die Erstzulassung muss mehr als ein Jahr vor der Übergabe liegen.',
    'Insufficient ATP for item {{item}} (Req: {{required}}, Available: {{available}})':
      'Unzureichender ATP-Bestand für Artikel {{item}} (benötigt: {{required}}, verfügbar: {{available}})',
  }),
)

const PHRASE_RULES = [
  [
    /^Insufficient ATP for item (.+) \(Req: ([^,]+), Available: (.+)\)$/,
    'Unzureichender ATP-Bestand für Artikel $1 (benötigt: $2, verfügbar: $3)',
  ],
  [/^(.+) is required\.?$/, '$1 ist erforderlich.'],
  [/^(.+) are required\.?$/, '$1 sind erforderlich.'],
  [/^(.+) failed\.?$/, '$1 fehlgeschlagen.'],
  [/^(.+) not found\.?$/, '$1 nicht gefunden.'],
  [/^Invalid (.+)\.?$/i, 'Ungültig: $1.'],
  [/^The (.+) is not (.+)\.?$/i, '$1 ist nicht $2.'],
  [/^This (.+) has no (.+)\.?$/i, 'Für $1 liegt kein $2 vor.'],
  [/^No (.+) exists for this (.+)\.?$/i, 'Für $2 existiert kein $1.'],
]

const WORD_MAP = new Map([
  ['required', 'erforderlich'],
  ['invalid', 'ungültig'],
  ['missing', 'fehlt'],
  ['unsupported', 'nicht unterstützt'],
  ['unavailable', 'nicht verfügbar'],
  ['disabled', 'deaktiviert'],
  ['failed', 'fehlgeschlagen'],
  ['incomplete', 'unvollständig'],
  ['conflict', 'Konflikt'],
  ['already', 'bereits'],
  ['active', 'aktiv'],
  ['vehicle', 'Fahrzeug'],
  ['customer', 'Kunde'],
  ['order', 'Auftrag'],
  ['invoice', 'Rechnung'],
  ['estimate', 'Kostenvoranschlag'],
  ['import', 'Import'],
  ['extraction', 'Extraktion'],
  ['letterhead', 'Briefkopf'],
  ['branding', 'Markenauftritt'],
  ['document', 'Dokument'],
  ['upload', 'Upload'],
  ['limit', 'Limit'],
  ['exceeded', 'überschritten'],
  ['configured', 'konfiguriert'],
  ['environment', 'Umgebung'],
])

function looksGerman(text) {
  return /\b(Dieser|Diese|Bitte|nicht|ist|sind|für|der|die|das|ein|eine|und|oder|wurde|wurden|können|muss|Fehler|Zu viele)\b/.test(
    text,
  )
}

function germanizeTokens(text) {
  return text
    .split(/(\s+|[^\w\s]+)/)
    .map((part) => {
      const lower = part.toLowerCase()
      if (WORD_MAP.has(lower)) {
        const mapped = WORD_MAP.get(lower)
        return part === part.toUpperCase() ? mapped.toUpperCase() : mapped
      }
      return part
    })
    .join('')
}

function translatePrefixedCodeMessage(text) {
  const match = /^([A-Z][A-Z0-9_]+):\s*(.+)$/.exec(text.trim())
  if (!match) {
    return null
  }
  const [, code, rest] = match
  // Never keep the wire code in user-facing DE copy; the code travels separately.
  return translateEnErrorToDe(rest, code)
}

/**
 * @param {string} en
 * @param {string} [code]
 * @returns {string}
 */
export function translateEnErrorToDe(en, code = '') {
  const trimmed = (en ?? '').trim()
  if (!trimmed) {
    return code ? `Fehler (${code}).` : 'Unbekannter Fehler.'
  }
  if (looksGerman(trimmed)) {
    return trimmed
  }
  if (EXACT.has(trimmed)) {
    return EXACT.get(trimmed)
  }

  const prefixed = translatePrefixedCodeMessage(trimmed)
  if (prefixed) {
    return prefixed
  }

  for (const [pattern, replacement] of PHRASE_RULES) {
    if (pattern.test(trimmed)) {
      const out = trimmed.replace(pattern, replacement)
      if (out !== trimmed) {
        return out
      }
    }
  }

  const tokenized = germanizeTokens(trimmed)
  if (tokenized !== trimmed) {
    return tokenized.endsWith('.') ? tokenized : `${tokenized}.`
  }

  if (code) {
    const human = code
      .split('_')
      .map((p) => WORD_MAP.get(p.toLowerCase()) ?? p.toLowerCase())
      .join(' ')
    return `${human.charAt(0).toUpperCase()}${human.slice(1)}.`
  }

  return `Hinweis: ${trimmed}`
}
