import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { CANONICAL_EN_MESSAGES } from './error-canonical-en.mjs'
import handDeCatalog from './error-de-hand-catalog.json' with { type: 'json' }
import { deTranslationFailsQualityCheck } from './error-de-quality.mjs'

const SYSTEM_WIRE_CODES = {
  HTTP_400: {
    en: 'The request could not be processed.',
    de: 'Die Anfrage konnte nicht verarbeitet werden.',
  },
  HTTP_401: {
    en: 'Authentication is required.',
    de: 'Bitte melden Sie sich an.',
  },
  HTTP_403: {
    en: 'You do not have permission for this action.',
    de: 'Sie haben keine Berechtigung für diese Aktion.',
  },
  HTTP_404: {
    en: 'The requested resource was not found.',
    de: 'Der Eintrag wurde nicht gefunden.',
  },
  HTTP_409: {
    en: 'The request conflicts with the current state.',
    de: 'Die Anfrage steht im Konflikt mit dem aktuellen Stand.',
  },
  HTTP_413: {
    en: 'The request payload is too large.',
    de: 'Die Anfrage ist zu groß.',
  },
  HTTP_415: {
    en: 'This media type is not supported.',
    de: 'Dieser Dateityp wird nicht unterstützt.',
  },
  HTTP_4XX: {
    en: 'The request could not be completed.',
    de: 'Die Anfrage konnte nicht abgeschlossen werden.',
  },
  HTTP_422: {
    en: 'The request could not be processed.',
    de: 'Die Anfrage konnte nicht verarbeitet werden.',
  },
  HTTP_429: {
    en: 'Too many requests. Please try again later.',
    de: 'Zu viele Anfragen. Bitte versuchen Sie es später erneut.',
  },
  HTTP_500: {
    en: 'An unexpected server error occurred.',
    de: 'Ein unerwarteter Fehler ist aufgetreten. Bitte versuchen Sie es erneut.',
  },
  HTTP_502: {
    en: 'The upstream service returned an invalid response.',
    de: 'Ein verbundener Dienst hat nicht korrekt geantwortet. Bitte versuchen Sie es erneut.',
  },
  HTTP_503: {
    en: 'The service is temporarily unavailable.',
    de: 'Der Dienst ist vorübergehend nicht verfügbar.',
  },
  HTTP_504: {
    en: 'The upstream service timed out.',
    de: 'Ein verbundener Dienst antwortet nicht. Bitte versuchen Sie es erneut.',
  },
  PRISMA_P2000: {
    en: 'The provided value is too long for one of the columns.',
    de: 'Ein eingegebener Wert ist zu lang.',
  },
  PRISMA_P2002: {
    en: 'A record with this value already exists.',
    de: 'Ein Eintrag mit diesem Wert existiert bereits.',
  },
  PRISMA_P2003: {
    en: 'This operation cannot be completed because of a related record.',
    de: 'Dieser Vorgang ist nicht möglich, weil noch verknüpfte Einträge bestehen.',
  },
  PRISMA_P2025: {
    en: 'The requested record was not found.',
    de: 'Der Eintrag wurde nicht gefunden.',
  },
}

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const CORE_API_SRC = path.join(REPO_ROOT, 'apps/core-api/src')
const LOCALES_ROOT = path.join(REPO_ROOT, 'locales')
const CLIENT_SAFE_FILE = path.join(
  CORE_API_SRC,
  'common/errors/client-safe-http-error-codes.ts',
)
const DETAIL_KEYS_FILE = CLIENT_SAFE_FILE

/** Wire codes that are never user-facing API errors (features, prisma, fixtures). */
const CODE_BLOCKLIST = new Set([
  'P2000',
  'P2002',
  'P2003',
  'P2025',
  'P2034',
  'P2014',
  'P2016',
  'BAD_REQUEST',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'UNAUTHORIZED',
  'ABS',
  'ESP',
  'ISOFIX',
  'BLUETOOTH',
  'NAVIGATION',
  'TOW_BAR',
  'S1',
  'MAIN',
  'TRANSIT',
  'MUC',
  'OP001',
  'TAKEN',
  'NETWORK',
  'EB2ADTS',
  'CHPA',
  'UNIVERSAL',
  'TIMEOUT',
  'STELLANTIS',
  'GRZ',
  'LOT',
  'LIGHTS',
  'BRAKES',
  'TYRES',
  'HORN',
  'QUEUED',
  'EUR',
  'B1',
  'B2',
  'EXT',
  'ARC',
  'BMW',
  'WAUZZZSYNTH000528',
])

/**
 * @param {string} filePath
 * @returns {Set<string>}
 */
export function parseClientSafeCodes(filePath = CLIENT_SAFE_FILE) {
  const text = fs.readFileSync(filePath, 'utf8')
  const codes = new Set()
  for (const match of text.matchAll(/'([A-Z][A-Z0-9_]+)'/g)) {
    codes.add(match[1])
  }
  return codes
}

/**
 * @param {string} filePath
 * @returns {Record<string, string[]>}
 */
export function parseClientSafeDetailKeys(filePath = DETAIL_KEYS_FILE) {
  const text = fs.readFileSync(filePath, 'utf8')
  const block = text.match(
    /CLIENT_SAFE_HTTP_ERROR_DETAIL_KEYS[\s\S]*?= \{([\s\S]*?)\};/,
  )
  if (!block) {
    return {}
  }
  const out = {}
  for (const row of block[1].matchAll(
    /([A-Z][A-Z0-9_]+):\s*\[([^\]]*)\]/g,
  )) {
    const keys = row[2]
      .split(',')
      .map((k) => k.trim().replace(/['"]/g, ''))
      .filter(Boolean)
    out[row[1]] = keys
  }
  return out
}

/**
 * @param {string} dir
 * @returns {Set<string>}
 */
function listSourceFiles(dir) {
  const out = []
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue
        walk(full)
        continue
      }
      if (!entry.name.endsWith('.ts')) continue
      if (entry.name.endsWith('.spec.ts')) continue
      out.push(full)
    }
  }
  walk(dir)
  return new Set(out)
}

/**
 * @param {string} src
 * @returns {string[]}
 */
function extractErrorCodeObjectValues(src) {
  const values = []
  for (const block of src.matchAll(
    /export const [A-Z0-9_]+_ERROR_CODES\s*=\s*\{([\s\S]*?)\}\s+as const/g,
  )) {
    for (const m of block[1].matchAll(/:\s*'([A-Z][A-Z0-9_]+)'/g)) {
      values.push(m[1])
    }
  }
  for (const block of src.matchAll(
    /export const [A-Z0-9_]+_BLOCKER_CODES\s*=\s*\[([\s\S]*?)\]\s+as const/g,
  )) {
    for (const m of block[1].matchAll(/'([A-Z][A-Z0-9_]+)'/g)) {
      values.push(m[1])
    }
  }
  for (const m of src.matchAll(
    /export const [A-Z0-9_]+_CODE\s*=\s*'([A-Z][A-Z0-9_]+)'/g,
  )) {
    values.push(m[1])
  }
  return values
}

/**
 * @param {string} src
 * @returns {Map<string, string>}
 */
const CODE_MESSAGE_GAP = 200

/**
 * @param {string} block
 * @returns {{ code: string, message: string } | null}
 */
function readCodeMessageFromObjectBlock(block) {
  const codeMatch = block.match(
    /code:\s*(?:[A-Z0-9_]+\.)?['"]([A-Z][A-Z0-9_]+)['"]/,
  )
  const messageMatch = block.match(/message:\s*['"]([^'"]+)['"]/)
  if (!codeMatch || !messageMatch) {
    return null
  }
  return { code: codeMatch[1], message: messageMatch[1] }
}

/**
 * Pair wire codes with messages only inside the same object literal (no cross-object scan).
 * @param {string} src
 * @returns {Map<string, string>}
 */
export function extractCodeMessagePairs(src) {
  const pairs = new Map()

  for (const m of src.matchAll(
    /\{\s*code:\s*(?:[A-Z0-9_]+\.)?['"]([A-Z][A-Z0-9_]+)['"]\s*,\s*message:\s*['"]([^'"]+)['"]\s*\}/g,
  )) {
    if (!pairs.has(m[1])) pairs.set(m[1], m[2])
  }
  for (const m of src.matchAll(
    /\{\s*message:\s*['"]([^'"]+)['"]\s*,\s*code:\s*(?:[A-Z0-9_]+\.)?['"]([A-Z][A-Z0-9_]+)['"]\s*\}/g,
  )) {
    if (!pairs.has(m[2])) pairs.set(m[2], m[1])
  }

  for (const m of src.matchAll(/throw\s+new\s+\w*Exception\(\s*\{([\s\S]*?)\}\s*,/g)) {
    const parsed = readCodeMessageFromObjectBlock(m[1])
    if (parsed && !pairs.has(parsed.code)) {
      pairs.set(parsed.code, parsed.message)
    }
  }

  const forwardCode =
    /code:\s*(?:[A-Z0-9_]+\.)?['"]([A-Z][A-Z0-9_]+)['"][\s\S]{0,200}?message:\s*['"]([^'"]+)['"]/g
  for (const m of src.matchAll(forwardCode)) {
    if (!pairs.has(m[1])) pairs.set(m[1], m[2])
  }
  const forwardMessage =
    /message:\s*['"]([^'"]+)['"][\s\S]{0,200}?code:\s*(?:[A-Z0-9_]+\.)?['"]([A-Z][A-Z0-9_]+)['"]/g
  for (const m of src.matchAll(forwardMessage)) {
    if (!pairs.has(m[2])) pairs.set(m[2], m[1])
  }

  return pairs
}

/**
 * @param {unknown} obj
 * @param {string[]} pathParts
 * @returns {Map<string, string>}
 */
function harvestLocaleCodes(obj, pathParts = []) {
  const out = new Map()
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return out
  }
  for (const [key, value] of Object.entries(obj)) {
    const parts = [...pathParts, key]
    const parent = pathParts[pathParts.length - 1]
    if (/^[A-Z][A-Z0-9_]+$/.test(key) && typeof value === 'string') {
      if (
        parent === 'errors' ||
        parent === 'codes' ||
        parts.some((p) => p === 'errors' || p === 'codes')
      ) {
        out.set(key, value)
      }
    }
    if (value && typeof value === 'object') {
      for (const [k, v] of harvestLocaleCodes(value, parts)) {
        out.set(k, v)
      }
    }
  }
  return out
}

/**
 * @param {'de' | 'en'} lang
 */
export function loadHarvestedTranslations(lang) {
  const merged = new Map()
  const dir = path.join(LOCALES_ROOT, lang)
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    if (file === 'errors.json') continue
    const json = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
    for (const [code, text] of harvestLocaleCodes(json)) {
      merged.set(code, text)
    }
  }
  return merged
}

/**
 * @param {string} code
 * @returns {string}
 */
export function humanizeCodeEn(code) {
  const words = code
    .split('_')
    .map((w) => w.toLowerCase())
    .join(' ')
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}.`
}

const DE_TOKEN_MAP = new Map([
  ['required', 'erforderlich'],
  ['invalid', 'ungültig'],
  ['missing', 'fehlt'],
  ['not', 'nicht'],
  ['found', 'gefunden'],
  ['conflict', 'Konflikt'],
  ['unsupported', 'nicht unterstützt'],
  ['unavailable', 'nicht verfügbar'],
  ['disabled', 'deaktiviert'],
  ['failed', 'fehlgeschlagen'],
  ['incomplete', 'unvollständig'],
  ['already', 'bereits'],
  ['active', 'aktiv'],
  ['site', 'Standort'],
  ['vehicle', 'Fahrzeug'],
  ['customer', 'Kunde'],
  ['order', 'Auftrag'],
  ['import', 'Import'],
  ['estimate', 'Kostenvoranschlag'],
  ['invoice', 'Rechnung'],
])

/**
 * @param {string} code
 * @param {string} [enFallback]
 */
export function fallbackDeMessage(code, enFallback) {
  const en = enFallback && enFallback.length > 0 ? enFallback : humanizeCodeEn(code)
  return translateEnErrorToDe(en, code)
}

/**
 * @returns {{ codes: Record<string, { public: boolean, params: string[] }>, messages: { en: Map<string,string>, de: Map<string,string> } }}
 */
export function buildRegistryModel() {
  const clientSafe = parseClientSafeCodes()
  const detailKeys = parseClientSafeDetailKeys()
  const files = listSourceFiles(CORE_API_SRC)
  const allCodes = new Set(clientSafe)
  const messagesEn = new Map()

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8')
    for (const code of extractErrorCodeObjectValues(src)) {
      if (!CODE_BLOCKLIST.has(code)) allCodes.add(code)
    }
    for (const [code, message] of extractCodeMessagePairs(src)) {
      if (CODE_BLOCKLIST.has(code)) continue
      if (!code.includes('_') && code.length < 10) continue
      allCodes.add(code)
      if (!messagesEn.has(code)) messagesEn.set(code, message)
    }
    for (const m of src.matchAll(/code:\s*'([A-Z][A-Z0-9_]+)'/g)) {
      const code = m[1]
      if (CODE_BLOCKLIST.has(code)) continue
      if (!code.includes('_')) continue
      allCodes.add(code)
    }
  }

  const harvestedEn = loadHarvestedTranslations('en')
  for (const [code, copy] of Object.entries(SYSTEM_WIRE_CODES)) {
    allCodes.add(code)
    messagesEn.set(code, copy.en)
  }
  const existingLocaleCodes = (lang) => {
    const errorsPath = path.join(LOCALES_ROOT, lang, 'errors.json')
    if (!fs.existsSync(errorsPath)) return {}
    return JSON.parse(fs.readFileSync(errorsPath, 'utf8')).codes ?? {}
  }
  const existingDeCodes = existingLocaleCodes('de')
  const existingEnCodes = existingLocaleCodes('en')

  const publicExtra = new Set([
    ...parseErrorCodeValuesFromImport(),
    'NOT_A_CATALOG_LINE',
  ])

  const codes = {}
  for (const code of [...allCodes].sort()) {
    const publicWire =
      clientSafe.has(code) ||
      publicExtra.has(code) ||
      code.startsWith('IMPORT_') ||
      code.startsWith('WARRANTY_CLAIM_') ||
      code.startsWith('AGENT_POLICY_') ||
      code.startsWith('CHECK_IN_') ||
      code.startsWith('ESTIMATE_') ||
      code.startsWith('REGISTRATION_INTAKE_') ||
      code.startsWith('BRAND_') ||
      code.startsWith('LISTING_') ||
      code.startsWith('VEHICLE_LISTING_') ||
      code.startsWith('GEWAEHRLEISTUNG_') ||
      code.startsWith('FISCAL_') ||
      code.startsWith('SETTLEMENT_') ||
      detailKeys[code] !== undefined

    codes[code] = {
      public: publicWire,
      params: detailKeys[code] ?? [],
    }

    if (!messagesEn.has(code)) {
      messagesEn.set(
        code,
        harvestedEn.get(code) ?? humanizeCodeEn(code),
      )
    }
    const params = detailKeys[code] ?? []
    if (params.length > 0) {
      const preservedEn = existingEnCodes[code]
      if (typeof preservedEn === 'string' && preservedEn.includes('{{')) {
        messagesEn.set(code, preservedEn)
      }
      const preservedDe = existingDeCodes[code]
      if (typeof preservedDe === 'string' && preservedDe.includes('{{')) {
        // applied in de loop below via existingDeCodes
      }
    }
  }

  const messages = {
    en: new Map(),
    de: new Map(),
  }
  for (const code of Object.keys(codes)) {
    const scannedEn = messagesEn.get(code) ?? humanizeCodeEn(code)
    const harvestedEnText = harvestedEn.get(code)
    const preservedEn = existingEnCodes[code]
    messages.en.set(
      code,
      CANONICAL_EN_MESSAGES[code] ??
        (typeof preservedEn === 'string' && preservedEn.trim().length > 0
          ? preservedEn
          : undefined) ??
        harvestedEnText ??
        scannedEn,
    )
    const enText = messages.en.get(code) ?? humanizeCodeEn(code)
    const systemDe = SYSTEM_WIRE_CODES[code]?.de
    const handDe = handDeCatalog[code] ?? systemDe
    if (!handDe || typeof handDe !== 'string' || handDe.trim().length === 0) {
      throw new Error(
        `Missing hand-written DE translation for ${code} in tools/error-de-hand-catalog.json`,
      )
    }
    if (deTranslationFailsQualityCheck(handDe, enText, code)) {
      throw new Error(
        `DE translation for ${code} still looks like English or equals EN`,
      )
    }
    messages.de.set(code, handDe)
  }

  return { codes, messages }
}

function parseErrorCodeValuesFromImport() {
  const file = path.join(CORE_API_SRC, 'import/import.constants.ts')
  const src = fs.readFileSync(file, 'utf8')
  return extractErrorCodeObjectValues(src)
}

/**
 * @param {{ codes: Record<string, { public: boolean, params: string[] }>, messages: { en: Map<string,string>, de: Map<string,string> } }} model
 */
export function writeGeneratedArtifacts(model) {
  const registryPath = path.join(
    CORE_API_SRC,
    'common/errors/public-error-code-registry.generated.json',
  )
  fs.writeFileSync(
    registryPath,
    `${JSON.stringify({ version: 1, codes: model.codes }, null, 2)}\n`,
  )

  const codesTsPath = path.join(
    REPO_ROOT,
    'apps/core-web/src/api/generated/public-error-codes.ts',
  )
  const publicCodes = Object.entries(model.codes)
    .filter(([, meta]) => meta.public)
    .map(([code]) => code)
    .sort()
  const paramsEntries = Object.entries(model.codes)
    .filter(([, meta]) => meta.params.length > 0)
    .sort(([a], [b]) => a.localeCompare(b))

  const ts = `/* eslint-disable */
// Generated by tools/generate-public-error-registry.mjs — do not edit.
export const PUBLIC_API_ERROR_CODES = ${JSON.stringify(publicCodes, null, 2)} as const
export type PublicApiErrorCode = (typeof PUBLIC_API_ERROR_CODES)[number]
export const PUBLIC_API_ERROR_CODE_PARAMS: Partial<Record<PublicApiErrorCode, readonly string[]>> = {
${paramsEntries.map(([code, meta]) => `  ${code}: ${JSON.stringify(meta.params)},`).join('\n')}
}
`
  fs.mkdirSync(path.dirname(codesTsPath), { recursive: true })
  fs.writeFileSync(codesTsPath, ts)

  for (const lang of ['de', 'en']) {
    const errorsPath = path.join(LOCALES_ROOT, lang, 'errors.json')
    const existing = JSON.parse(fs.readFileSync(errorsPath, 'utf8'))
    const codeMap = {}
    for (const code of Object.keys(model.codes).sort()) {
      codeMap[code] = model.messages[lang].get(code)
    }
    const next = {
      ...existing,
      generic: existing.generic ?? {
        unexpected:
          lang === 'de'
            ? 'Ein unerwarteter Fehler ist aufgetreten.'
            : 'An unexpected error occurred.',
      },
      codes: codeMap,
    }
    fs.writeFileSync(errorsPath, `${JSON.stringify(next, null, 2)}\n`)
  }

  syncClientSafeAllowlist(model)

  return {
    registryPath,
    codesTsPath,
    codeCount: Object.keys(model.codes).length,
    publicCount: publicCodes.length,
  }
}

/**
 * Append missing public wire codes to CLIENT_SAFE_HTTP_ERROR_CODES.
 * @param {{ codes: Record<string, { public: boolean }> }} model
 */
function syncClientSafeAllowlist(model) {
  let text = fs.readFileSync(CLIENT_SAFE_FILE, 'utf8')
  if (text.includes('// AUT-585 generated public wire codes')) {
    return
  }
  const existing = parseClientSafeCodes()
  const missing = Object.entries(model.codes)
    .filter(([code, meta]) => meta.public && !existing.has(code))
    .map(([code]) => code)
    .sort()

  if (missing.length === 0) {
    return
  }

  const insertion = missing.map((c) => `  '${c}',`).join('\n')
  text = text.replace(
    /(\n\]\);)/,
    `\n  // AUT-585 generated public wire codes\n${insertion}$1`,
  )
  fs.writeFileSync(CLIENT_SAFE_FILE, text)
}

export function runRegistryGeneration() {
  const model = buildRegistryModel()
  return writeGeneratedArtifacts(model)
}
