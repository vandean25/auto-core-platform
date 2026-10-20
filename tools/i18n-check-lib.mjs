import fs from 'node:fs'
import path from 'node:path'

const PLURAL_SUFFIXES = new Set(['zero', 'one', 'two', 'few', 'many', 'other'])
const INTERPOLATION_RE = /\{\{(\w+)\}\}/g
const DEFAULT_LOCALES_ROOT = 'locales'
const DEFAULT_MANIFEST = 'tools/i18n-check-manifest.json'
const DEFAULT_SCAN_ROOT = 'apps/core-web/src'

/**
 * @param {unknown} value
 * @param {string} [prefix]
 * @returns {string[]}
 */
export function collectLeafKeys(value, prefix = '') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? [prefix] : []
  }
  return Object.entries(value).flatMap(([key, child]) => {
    const next = prefix ? `${prefix}.${key}` : key
    if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
      return collectLeafKeys(child, next)
    }
    return [next]
  })
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function interpolationVariables(text) {
  if (typeof text !== 'string') {
    return []
  }
  const vars = new Set()
  for (const match of text.matchAll(INTERPOLATION_RE)) {
    vars.add(match[1])
  }
  return [...vars].sort()
}

/**
 * @param {string} leafKey e.g. minutesAgo_one
 * @returns {{ base: string, plural?: string }}
 */
export function splitPluralLeafKey(leafKey) {
  const lastDot = leafKey.lastIndexOf('.')
  const segment = lastDot === -1 ? leafKey : leafKey.slice(lastDot + 1)
  const prefix = lastDot === -1 ? '' : `${leafKey.slice(0, lastDot)}.`
  const underscore = segment.lastIndexOf('_')
  if (underscore === -1) {
    return { base: leafKey }
  }
  const plural = segment.slice(underscore + 1)
  if (!PLURAL_SUFFIXES.has(plural)) {
    return { base: leafKey }
  }
  const baseSegment = segment.slice(0, underscore)
  return { base: `${prefix}${baseSegment}`, plural }
}

/**
 * @param {string[]} leafKeys
 * @returns {Map<string, Set<string>>}
 */
export function pluralFamilies(leafKeys) {
  const families = new Map()
  for (const leaf of leafKeys) {
    const { base, plural } = splitPluralLeafKey(leaf)
    if (!plural) {
      continue
    }
    const set = families.get(base) ?? new Set()
    set.add(plural)
    families.set(base, set)
  }
  return families
}

/**
 * @param {string} localesRoot
 * @param {string} language
 * @returns {Map<string, Record<string, unknown>>}
 */
export function loadLocaleNamespaces(localesRoot, language) {
  const dir = path.join(localesRoot, language)
  const namespaces = new Map()
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.json'))) {
    const namespace = file.replace(/\.json$/, '')
    const raw = fs.readFileSync(path.join(dir, file), 'utf8')
    namespaces.set(namespace, JSON.parse(raw))
  }
  return namespaces
}

/**
 * @param {Map<string, Record<string, unknown>>} namespaces
 * @returns {Map<string, string>}
 */
export function flattenResourceKeys(namespaces) {
  const out = new Map()
  for (const [namespace, tree] of namespaces) {
    for (const leaf of collectLeafKeys(tree)) {
      out.set(`${namespace}:${leaf}`, leaf)
    }
  }
  return out
}

/**
 * @param {Map<string, Record<string, unknown>>} namespaces
 * @param {string} qualifiedKey namespace:dot.path
 * @returns {string|undefined}
 */
export function resolveResourceValue(namespaces, qualifiedKey) {
  const colon = qualifiedKey.indexOf(':')
  if (colon === -1) {
    return undefined
  }
  const namespace = qualifiedKey.slice(0, colon)
  const leafPath = qualifiedKey.slice(colon + 1)
  const tree = namespaces.get(namespace)
  if (!tree) {
    return undefined
  }
  let current = tree
  for (const segment of leafPath.split('.')) {
    if (current === null || typeof current !== 'object') {
      return undefined
    }
    current = current[segment]
  }
  return typeof current === 'string' ? current : undefined
}

/**
 * @param {string} manifestPath
 */
export function loadManifest(manifestPath = DEFAULT_MANIFEST) {
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  return {
    treatNamespaceAsUsed: raw.treatNamespaceAsUsed ?? [],
    usedKeyPrefixes: raw.usedKeyPrefixes ?? [],
    usedKeys: raw.usedKeys ?? [],
  }
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function walkSourceFiles(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walkSourceFiles(full))
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) {
      continue
    }
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) {
      continue
    }
    if (full.includes(`${path.sep}api${path.sep}generated${path.sep}`)) {
      continue
    }
    out.push(full)
  }
  return out
}

/**
 * @param {string} source
 * @returns {string[]}
 */
export function inferDefaultNamespaces(source) {
  const namespaces = []
  const useTranslationRe =
    /useTranslation\(\s*(?:\[([^\]]+)\]|['"]([a-zA-Z0-9_-]+)['"])/g
  for (const match of source.matchAll(useTranslationRe)) {
    if (match[1]) {
      const first = match[1].match(/['"]([a-zA-Z0-9_-]+)['"]/)
      if (first) {
        namespaces.push(first[1])
      }
    } else if (match[2]) {
      namespaces.push(match[2])
    }
  }
  const fixedTRe = /getFixedT\([^,]+,\s*['"]([a-zA-Z0-9_-]+)['"]/g
  for (const match of source.matchAll(fixedTRe)) {
    namespaces.push(match[1])
  }
  return namespaces
}

/**
 * @param {string} source
 * @param {string} defaultNamespace
 * @param {string} [filePath]
 * @returns {Set<string>}
 */
export function extractTranslationKeysFromSource(source, defaultNamespace, filePath = '') {
  const keys = new Set()

  const addKey = (raw, namespace = defaultNamespace) => {
    if (!raw || raw.includes('${')) {
      return
    }
    if (raw.includes(':')) {
      keys.add(raw)
      return
    }
    if (namespace) {
      keys.add(`${namespace}:${raw}`)
    }
  }

  const callPatterns = [
    /\b(?:t|i18n\.t)\(\s*['"]([^'"]+)['"]/g,
    /\btranslateEnum\(\s*([^)]+)\)/g,
    /\benumTranslationKey\(\s*([^)]+)\)/g,
  ]

  for (const pattern of callPatterns) {
    for (const match of source.matchAll(pattern)) {
      if (pattern === callPatterns[0]) {
        addKey(match[1])
        continue
      }
      const args = match[1]
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => part.replace(/^['"]|['"]$/g, ''))
        .filter((part) => /^[a-zA-Z0-9_.-]+$/.test(part))
      if (args.length > 0) {
        keys.add(`enums:${args.join('.')}`)
      }
    }
  }

  for (const match of source.matchAll(/return\s+['"]([a-zA-Z0-9_.]+)['"]/g)) {
    addKey(match[1])
  }

  for (const match of source.matchAll(/labelKey:\s*['"]([^'"]+)['"]/g)) {
    const namespace =
      filePath.includes('nav-config') || source.includes("useTranslation('nav')") ? 'nav' : defaultNamespace
    addKey(match[1], namespace)
  }

  if (source.includes('LOGIN_HIGHLIGHT_KEYS')) {
    const arrayMatch = source.match(/LOGIN_HIGHLIGHT_KEYS\s*=\s*\[([^\]]+)\]/)
    if (arrayMatch) {
      for (const key of arrayMatch[1].matchAll(/['"]([a-z]+)['"]/g)) {
        addKey(`login.highlights.${key[1]}`)
      }
    }
  }

  if (source.includes('SHELL_GLOSSARY_KEYS')) {
    const arrayMatch = source.match(/SHELL_GLOSSARY_KEYS\s*=\s*\[([^\]]+)\]/)
    if (arrayMatch) {
      for (const term of arrayMatch[1].matchAll(/['"]([a-zA-Z]+)['"]/g)) {
        for (const suffix of ['term', 'short', 'description']) {
          keys.add(`glossary:${term[1]}.${suffix}`)
        }
      }
    }
  }

  return keys
}

/**
 * @param {Set<string>} usedKeys
 * @param {Set<string>} allQualifiedKeys
 */
export function expandPluralKeyUsage(usedKeys, allQualifiedKeys) {
  for (const qualifiedKey of [...usedKeys]) {
    const colon = qualifiedKey.indexOf(':')
    if (colon === -1) {
      continue
    }
    const namespace = qualifiedKey.slice(0, colon)
    const leaf = qualifiedKey.slice(colon + 1)
    const { base, plural } = splitPluralLeafKey(leaf)
    if (plural) {
      continue
    }
    for (const candidate of allQualifiedKeys) {
      if (!candidate.startsWith(`${namespace}:`)) {
        continue
      }
      const candidateLeaf = candidate.slice(colon + 1)
      const split = splitPluralLeafKey(candidateLeaf)
      if (split.base === leaf && split.plural) {
        usedKeys.add(candidate)
      }
    }
  }
}

/**
 * @param {string} scanRoot
 * @returns {Set<string>}
 */
export function collectUsedKeysFromSources(scanRoot = DEFAULT_SCAN_ROOT) {
  const used = new Set()
  for (const file of walkSourceFiles(scanRoot)) {
    const source = fs.readFileSync(file, 'utf8')
    const defaultNamespaces = inferDefaultNamespaces(source)
    const defaultNamespace = defaultNamespaces[0] ?? 'common'
    for (const key of extractTranslationKeysFromSource(source, defaultNamespace, file)) {
      used.add(key)
    }
    for (const ns of defaultNamespaces.slice(1)) {
      for (const key of extractTranslationKeysFromSource(source, ns, file)) {
        used.add(key)
      }
    }
  }
  return used
}

/**
 * @param {string} qualifiedKey
 * @param {{ treatNamespaceAsUsed: string[], usedKeyPrefixes: string[], usedKeys: string[] }} manifest
 */
export function isKeyTreatedAsUsed(qualifiedKey, manifest) {
  if (manifest.usedKeys.includes(qualifiedKey)) {
    return true
  }
  const namespace = qualifiedKey.split(':')[0]
  if (manifest.treatNamespaceAsUsed.includes(namespace)) {
    return true
  }
  return manifest.usedKeyPrefixes.some((prefix) => qualifiedKey.startsWith(prefix))
}

/**
 * @param {object} options
 * @param {string} [options.localesRoot]
 * @param {string} [options.manifestPath]
 * @param {string} [options.scanRoot]
 * @param {boolean} [options.failOnUnused]
 */
export function runI18nCheck(options = {}) {
  const localesRoot = options.localesRoot ?? DEFAULT_LOCALES_ROOT
  const manifestPath = options.manifestPath ?? DEFAULT_MANIFEST
  const scanRoot = options.scanRoot ?? DEFAULT_SCAN_ROOT
  const failOnUnused = options.failOnUnused ?? false

  const languages = ['de', 'en']
  const byLanguage = new Map(
    languages.map((language) => [language, loadLocaleNamespaces(localesRoot, language)]),
  )

  const errors = []
  const warnings = []

  const namespaceSets = languages.map((language) => new Set(byLanguage.get(language).keys()))
  const allNamespaces = new Set(namespaceSets.flatMap((set) => [...set]))
  for (const language of languages) {
    for (const namespace of allNamespaces) {
      if (!byLanguage.get(language).has(namespace)) {
        errors.push(`Missing namespace file locales/${language}/${namespace}.json`)
      }
    }
  }

  const flatByLanguage = new Map(
    languages.map((language) => [language, flattenResourceKeys(byLanguage.get(language))]),
  )

  const allQualifiedKeys = new Set(
    languages.flatMap((language) => [...flatByLanguage.get(language).keys()]),
  )

  for (const qualifiedKey of [...allQualifiedKeys].sort()) {
    for (const language of languages) {
      if (!flatByLanguage.get(language).has(qualifiedKey)) {
        errors.push(`Missing ${language} translation for ${qualifiedKey}`)
      }
    }

    const deValue = resolveResourceValue(byLanguage.get('de'), qualifiedKey)
    const enValue = resolveResourceValue(byLanguage.get('en'), qualifiedKey)
    if (deValue !== undefined && enValue !== undefined) {
      if (!deValue.trim()) {
        errors.push(`Empty de value for ${qualifiedKey}`)
      }
      if (!enValue.trim()) {
        errors.push(`Empty en value for ${qualifiedKey}`)
      }
      const deVars = interpolationVariables(deValue)
      const enVars = interpolationVariables(enValue)
      if (deVars.join(',') !== enVars.join(',')) {
        errors.push(
          `Interpolation mismatch for ${qualifiedKey}: de [${deVars.join(', ')}] vs en [${enVars.join(', ')}]`,
        )
      }
    }
  }

  const deLeafKeys = [...flatByLanguage.get('de').keys()].map((key) => key.slice(key.indexOf(':') + 1))
  const enLeafKeys = [...flatByLanguage.get('en').keys()].map((key) => key.slice(key.indexOf(':') + 1))
  const deFamilies = pluralFamilies(deLeafKeys)
  const enFamilies = pluralFamilies(enLeafKeys)
  const familyNames = new Set([...deFamilies.keys(), ...enFamilies.keys()])
  for (const family of [...familyNames].sort()) {
    const deForms = [...(deFamilies.get(family) ?? new Set())].sort().join(',')
    const enForms = [...(enFamilies.get(family) ?? new Set())].sort().join(',')
    if (deForms !== enForms) {
      errors.push(`Plural form mismatch for ${family}: de [${deForms}] vs en [${enForms}]`)
    }
  }

  const manifest = loadManifest(manifestPath)
  const usedKeys = collectUsedKeysFromSources(scanRoot)
  expandPluralKeyUsage(usedKeys, allQualifiedKeys)
  const unused = []
  for (const qualifiedKey of [...allQualifiedKeys].sort()) {
    if (usedKeys.has(qualifiedKey) || isKeyTreatedAsUsed(qualifiedKey, manifest)) {
      continue
    }
    unused.push(qualifiedKey)
  }

  if (unused.length > 0) {
    const message = `Unused translation keys (${unused.length}):\n${unused.map((key) => `  - ${key}`).join('\n')}`
    if (failOnUnused) {
      errors.push(message)
    } else {
      warnings.push(message)
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      namespaces: allNamespaces.size,
      keys: allQualifiedKeys.size,
      usedKeysDetected: usedKeys.size,
      unusedKeys: unused.length,
    },
  }
}
