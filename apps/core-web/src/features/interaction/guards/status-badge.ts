import { statusClassMap } from '@/components/status/status-class-map'
import { analyzeSource, findClosing, type AnalyzedSource } from './source-text'

/**
 * StatusBadge guard (AUT-1017).
 *
 * Enforces that status styling goes through `StatusBadge` + `statusClassMap` rather than ad hoc
 * tinted-tone pills (`bg-(success|warning|destructive|info)/<n>`) or local status-to-class maps
 * outside `components/status/`.
 */

const STATUS_CLASS_KEYS = new Set(Object.keys(statusClassMap))
const EXCLUDED_PATH = /^(?:components\/status|components\/ui)\//
const NON_PRODUCTION_FILE = /\.(?:test|spec|stories|testUtils)\.|(?:^|\/)__tests__\//
const TINTED_TONE = /(?<![A-Za-z0-9_-])bg-(?:success|warning|destructive|info)\/\d+/
const CLASS_STRING_VALUE = /(?:^|\s)(?:bg|text|border|ring)-/
const OBJECT_ENTRY = /^\s*['"]?([A-Z][A-Z0-9_]*)['"]?\s*:\s*(['"`])([^'"`\n]*)\2\s*$/

export type StatusBadgeGuardResult = {
  violations: string[]
}

export type MissingStatusLabel = {
  key: string
  missingIn: Array<'de' | 'en'>
}

function isScannedFile(path: string): boolean {
  return path.endsWith('.tsx') && !EXCLUDED_PATH.test(path) && !NON_PRODUCTION_FILE.test(path)
}

function isStatusClassObject(body: string): boolean {
  if (body.includes('{')) return false
  const parts = body
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length < 2) return false

  let hasClassValue = false
  for (const part of parts) {
    const match = OBJECT_ENTRY.exec(part)
    if (!match) return false
    const [, key, , value] = match
    if (!STATUS_CLASS_KEYS.has(key!)) return false
    if (CLASS_STRING_VALUE.test(value!)) hasClassValue = true
  }
  return hasClassValue
}

function hasLocalStatusMap(analyzed: AnalyzedSource): boolean {
  const { masked, code } = analyzed
  for (let i = 0; i < masked.length; i += 1) {
    if (code[i] !== 1 || masked[i] !== '{') continue
    const close = findClosing(analyzed, i)
    if (close !== -1 && isStatusClassObject(masked.slice(i + 1, close))) return true
  }
  return false
}

function fileViolations(path: string, source: string): string[] {
  const analyzed = analyzeSource(source)
  const violations: string[] = []
  if (TINTED_TONE.test(analyzed.masked)) violations.push(`${path}::tinted-tone`)
  if (hasLocalStatusMap(analyzed)) violations.push(`${path}::local-status-map`)
  return violations
}

export function evaluateStatusBadgeGuard(
  sources: Readonly<Record<string, string>>,
): StatusBadgeGuardResult {
  const violations = Object.entries(sources)
    .filter(([path]) => isScannedFile(path))
    .flatMap(([path, source]) => fileViolations(path, source))
    .sort()
  return { violations }
}

export function findMissingStatusLabels(
  keys: readonly string[],
  deStatus: Readonly<Record<string, string | undefined>>,
  enStatus: Readonly<Record<string, string | undefined>>,
): MissingStatusLabel[] {
  const missing: MissingStatusLabel[] = []
  for (const key of keys) {
    const langs: Array<'de' | 'en'> = []
    if (!deStatus[key]?.trim()) langs.push('de')
    if (!enStatus[key]?.trim()) langs.push('en')
    if (langs.length > 0) missing.push({ key, missingIn: langs })
  }
  return missing
}
