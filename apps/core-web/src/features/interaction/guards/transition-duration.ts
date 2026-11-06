import { motionDurationClass, motionDurationMs } from '@/lib/motion-tokens'
import { analyzeSource, findClosing, type AnalyzedSource } from './source-text'

/**
 * Transition-duration guard (ADR-0036 R6, AUT-893).
 *
 * Finite interaction transitions are capped at the sheet/dialog token (200 ms). The guard resolves
 * Tailwind `duration-*` classes, CSS `transition`/`animation` declarations and motion/JavaScript
 * durations (framer-motion `duration:` in seconds, dnd-kit / Web Animations / recharts in ms, inline
 * style strings) to milliseconds through `@/lib/motion-tokens`. A value above the cap is a violation.
 * A value that cannot be resolved statically (a variable, a computed expression, an interpolated class)
 * is also a violation: unknown dynamic durations need review, they never pass silently.
 * Repeating functional indicators (`animate-spin`, `repeat: Infinity`, `infinite`) are classified
 * separately and are not capped. Non-motion timings (debounce, skeleton delay, toast lifetime, request
 * timeouts) are not transitions and are not scanned.
 */

export const FINITE_TRANSITION_CAP_MS = motionDurationMs.overlay

const TOKEN_MS: Readonly<Record<string, number>> = motionDurationMs
const TOKEN_CLASS: Readonly<Record<string, string>> = motionDurationClass

/** The token module defines the literals every other file must resolve through. */
const TOKEN_DEFINITION_FILE = 'lib/motion-tokens.ts'
const REPEATING_CLASS = /(?<![\w-])(?:[\w[\]:-]+:)?animate-(?:spin|pulse|ping|bounce)\b/
const TAILWIND_DURATION =
  /(?<![A-Za-z0-9_-])duration-(\[[^\]\s]+\]|\(--[^)\s]+\)|\d+|\$\{[^}]*\})/g
const STRING_LITERAL = /`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g
const MOTION_LIBRARY_IMPORT = /from\s*['"](framer-motion|motion(?:\/react)?|@dnd-kit\/[\w-]+|recharts)['"]/
const SECONDS_LIBRARY_IMPORT = /from\s*['"](framer-motion|motion(?:\/react)?)['"]/
const DURATION_PROPERTY = /(?<![\w$])duration\s*:\s*([^,}\n]+)/g
const ANIMATION_DURATION_PROP = /(?<![\w$])animationDuration\s*=\s*\{([^}]*)\}/g
const STYLE_DURATION = /(?<![\w$])(transitionDuration|animationDuration)\s*:\s*([^,}\n]+)/g
const STYLE_SHORTHAND = /(?<![\w$])(transition|animation)\s*:\s*(['"`])([^'"`]*)\2/g
const CSS_DECLARATION =
  /(?<![\w-])(transition-duration|animation-duration|transition|animation|--default-transition-duration)\s*:\s*([^;}]+)/g

type Finding = { id: string; ms: number | 'unknown'; repeating: boolean }
type ResolvedValue = { ms: number | 'unknown'; label: string }

function parseTimeMs(text: string): number | undefined {
  const match = /^(-?\d*\.?\d+)\s*(ms|s)$/.exec(text.trim())
  if (!match) return undefined
  return match[2] === 's' ? Number(match[1]) * 1000 : Number(match[1])
}

function formatMs(ms: number): string {
  return `${Math.round(ms * 1000) / 1000}ms`
}

function tailwindMs(raw: string): number | 'unknown' {
  if (/^\d+$/.test(raw)) return Number(raw)
  return (raw.startsWith('[') ? parseTimeMs(raw.slice(1, -1)) : undefined) ?? 'unknown'
}

function tailwindFindings(path: string, text: string): Finding[] {
  const resolved = text.replace(
    /\$\{\s*motionDurationClass\.(\w+)\s*\}/g,
    (whole, name: string) => TOKEN_CLASS[name] ?? whole,
  )
  const repeating = REPEATING_CLASS.test(resolved)
  return [...resolved.matchAll(TAILWIND_DURATION)].map((match) => {
    const ms = tailwindMs(match[1]!)
    const kind = ms === 'unknown' ? 'tailwind-dynamic' : 'tailwind'
    return { id: `${path}::${kind}::duration-${match[1]}`, ms, repeating }
  })
}

function enclosingObjectText(analyzed: AnalyzedSource, index: number): string {
  const level = analyzed.depth[index]!
  for (let i = index; i >= 0; i -= 1) {
    if (analyzed.code[i] && analyzed.masked[i] === '{' && analyzed.depth[i] === level - 1) {
      const close = findClosing(analyzed, i)
      return close === -1 ? '' : analyzed.masked.slice(i, close + 1)
    }
  }
  return ''
}

function resolveToken(text: string, secondsUnit: boolean): ResolvedValue | undefined {
  const token = /^motionDurationMs\.(\w+)\s*(\/\s*1000)?$/.exec(text)
  const name = token?.[1]
  if (!name || !(name in TOKEN_MS)) return undefined
  // A token is milliseconds; the value must be scaled to the unit its library expects.
  const matchesUnit = Boolean(token[2]) === secondsUnit
  return { ms: matchesUnit ? TOKEN_MS[name]! : 'unknown', label: text }
}

function resolveNumber(text: string, secondsUnit: boolean): ResolvedValue | undefined {
  if (!/^-?\d*\.?\d+$/.test(text)) return undefined
  const ms = secondsUnit ? Number(text) * 1000 : Number(text)
  return { ms, label: formatMs(ms) }
}

function resolveTimeString(text: string): ResolvedValue | undefined {
  const ms = parseTimeMs(text.replace(/^['"`]|['"`]$/g, ''))
  return ms === undefined ? undefined : { ms, label: formatMs(ms) }
}

function resolveJsValue(expression: string, secondsUnit: boolean): ResolvedValue {
  const text = expression.trim()
  return (
    resolveToken(text, secondsUnit) ??
    resolveNumber(text, secondsUnit) ??
    resolveTimeString(text) ?? { ms: 'unknown', label: text }
  )
}

function jsFinding(path: string, descriptor: string, ms: number | 'unknown', repeating: boolean): Finding {
  const kind = ms === 'unknown' ? 'js-dynamic' : 'js'
  return { id: `${path}::${kind}::${descriptor}`, ms, repeating }
}

/** framer-motion `duration:` in seconds, dnd-kit and Web Animations in ms; `repeat: Infinity` is a loop. */
function durationPropertyFindings(path: string, analyzed: AnalyzedSource, secondsUnit: boolean): Finding[] {
  return [...analyzed.masked.matchAll(DURATION_PROPERTY)]
    .filter((match) => analyzed.code[match.index ?? 0] === 1)
    .map((match) => {
      const { ms, label } = resolveJsValue(match[1]!, secondsUnit)
      const loops = /\brepeat\s*:\s*Infinity\b/.test(enclosingObjectText(analyzed, match.index ?? 0))
      return jsFinding(path, `duration=${label}`, ms, loops)
    })
}

function libraryDurationFindings(path: string, analyzed: AnalyzedSource): Finding[] {
  const { masked } = analyzed
  if (!MOTION_LIBRARY_IMPORT.test(masked) && !/\.animate\(/.test(masked)) return []
  const props = [...masked.matchAll(ANIMATION_DURATION_PROP)].map((match) => {
    const { ms, label } = resolveJsValue(match[1]!, false)
    return jsFinding(path, `animationDuration=${label}`, ms, false)
  })
  return [...durationPropertyFindings(path, analyzed, SECONDS_LIBRARY_IMPORT.test(masked)), ...props]
}

function styleStringFindings(path: string, masked: string): Finding[] {
  const longhands = [...masked.matchAll(STYLE_DURATION)].map((match) => {
    const { ms, label } = resolveJsValue(match[2]!, false)
    return jsFinding(path, `${match[1]}=${label}`, ms, false)
  })
  const shorthands = [...masked.matchAll(STYLE_SHORTHAND)].flatMap((match) =>
    shorthandFindings(`${path}::js`, match[1]!, match[3]!),
  )
  return [...longhands, ...shorthands]
}

/** `opacity 150ms ease, transform 0.3s` -> one finding per comma-separated item (first time is the duration). */
function shorthandFindings(prefix: string, property: string, value: string): Finding[] {
  return value.split(/,(?![^(]*\))/).flatMap((item) => {
    const time = /(?<![\w.-])(-?\d*\.?\d+(?:ms|s))(?![\w-])/.exec(item)?.[1]
    if (!time) return []
    const ms = parseTimeMs(time)!
    return [{ id: `${prefix}::${property}=${formatMs(ms)}`, ms, repeating: /\binfinite\b/.test(item) }]
  })
}

function customProperties(masked: string): Map<string, string> {
  return new Map([...masked.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)].map((match) => [match[1]!, match[2]!.trim()]))
}

/** Substitutes known custom properties; `dynamic` is the first `var()` that could not be resolved. */
function resolveVars(value: string, properties: ReadonlyMap<string, string>): { text: string; dynamic?: string } {
  let dynamic: string | undefined
  const text = value.replace(/var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)/g, (whole, name: string) => {
    const known = properties.get(name)
    if (known === undefined) dynamic ??= whole
    return known ?? whole
  })
  return { text, dynamic }
}

function durationListFindings(path: string, property: string, text: string): Finding[] {
  return text.split(',').flatMap((part) => {
    const ms = parseTimeMs(part)
    return ms === undefined ? [] : [{ id: `${path}::css::${property}=${formatMs(ms)}`, ms, repeating: false }]
  })
}

function declarationFindings(
  path: string,
  property: string,
  value: string,
  properties: ReadonlyMap<string, string>,
): Finding[] {
  const { text, dynamic } = resolveVars(value, properties)
  if (dynamic || /\bcalc\(/.test(text)) {
    const unresolved = (dynamic ?? text).trim()
    return [{ id: `${path}::css-dynamic::${property}=${unresolved}`, ms: 'unknown', repeating: false }]
  }
  return property.endsWith('duration')
    ? durationListFindings(path, property, text)
    : shorthandFindings(`${path}::css`, property, text)
}

function cssFindings(path: string, masked: string): Finding[] {
  const properties = customProperties(masked)
  const declarations = [...masked.matchAll(CSS_DECLARATION)].flatMap((match) =>
    declarationFindings(path, match[1]!, match[2]!, properties),
  )
  const applied = [...masked.matchAll(/@apply\s+([^;}]+)/g)].flatMap((match) => tailwindFindings(path, match[1]!))
  return [...declarations, ...applied]
}

function codeStringFindings(path: string, analyzed: AnalyzedSource): Finding[] {
  return [...analyzed.masked.matchAll(STRING_LITERAL)]
    .filter((match) => analyzed.code[match.index ?? 0] === 1)
    .flatMap((match) => tailwindFindings(path, match[0]))
}

function scriptFindings(path: string, analyzed: AnalyzedSource): Finding[] {
  return [
    ...codeStringFindings(path, analyzed),
    ...libraryDurationFindings(path, analyzed),
    ...styleStringFindings(path, analyzed.masked),
  ]
}

function scanFile(path: string, source: string): Finding[] {
  if (path === TOKEN_DEFINITION_FILE) return []
  const analyzed = analyzeSource(source)
  return path.endsWith('.css') ? cssFindings(path, analyzed.masked) : scriptFindings(path, analyzed)
}

function exceedsCap(finding: Finding): boolean {
  return finding.ms === 'unknown' || finding.ms > FINITE_TRANSITION_CAP_MS
}

type DurationGuardResult = {
  violations: string[]
  /** Repeating functional indicators found, listed so the classification stays visible in tests. */
  repeating: string[]
}

export function evaluateDurationGuard(sources: Readonly<Record<string, string>>): DurationGuardResult {
  const findings = Object.entries(sources)
    .filter(([path]) => /\.(?:tsx?|css)$/.test(path))
    .flatMap(([path, source]) => scanFile(path, source))
  const ids = (selected: Finding[]) => selected.map((finding) => finding.id).sort()
  return {
    violations: ids(findings.filter((finding) => !finding.repeating && exceedsCap(finding))),
    repeating: ids(findings.filter((finding) => finding.repeating)),
  }
}
