/** Codes where DE may legitimately match EN (brand names, acronyms). */
export const DE_EN_IDENTICAL_ALLOWLIST = new Set([
  'BMW',
  'EUR',
  'ISOFIX',
  'ESP',
  'ABS',
  'BLUETOOTH',
  'NAVIGATION',
  'MOBILE_DE_REFERENCE_V1',
])

const ENGLISH_MARKERS =
  /\b(the|this|please|must|could|already|failed|request|invalid|cannot|unable|should|would|have|has|was|were|your|with|from|into|when|while|before|after)\b/i

/**
 * Technical text that must never reach users in DE copy (see .agents/skills/acp-i18n/SKILL.md):
 * leading error codes, API paths and HTTP verbs, snake_case field names, transport jargon,
 * and "VIN" (de-AT uses "FIN").
 */
const DE_TECHNICAL_MARKERS = [
  /^[A-Z][A-Z0-9_]{2,}:\s/,
  /\/api\//,
  /\b(GET|POST|PUT|PATCH|DELETE)\s+\//,
  /\b[a-z]+_[a-z0-9_]+\b/,
  /idempoten/i,
  /rate-limit/i,
  /\bVIN\b/,
  /\b(Synthetisch\w*|Serializer|Outbox|Payload|Header|Snapshot|Endpoint)\b/i,
]

/**
 * @param {string} deText
 * @returns {boolean} true when the DE text contains technical markers
 */
export function deTranslationHasTechnicalText(deText) {
  return DE_TECHNICAL_MARKERS.some((pattern) => pattern.test(deText))
}

/**
 * @param {string} deText
 * @param {string} enText
 * @param {string} code
 */
export function deTranslationFailsQualityCheck(deText, enText, code) {
  if (DE_EN_IDENTICAL_ALLOWLIST.has(code)) {
    return false
  }
  const de = deText.trim()
  const en = enText.trim()
  if (!de || !en) {
    return true
  }
  if (de === en) {
    return true
  }
  if (ENGLISH_MARKERS.test(de)) {
    return true
  }
  if (deTranslationHasTechnicalText(de)) {
    return true
  }
  return false
}
