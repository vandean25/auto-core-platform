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
  return false
}
