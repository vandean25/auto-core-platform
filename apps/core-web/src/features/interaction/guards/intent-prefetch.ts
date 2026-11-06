import { analyzeSource, type AnalyzedSource } from './source-text'

/**
 * Intent-prefetch guard (ADR-0036 R4, AUT-893).
 *
 * A navigable `DataTable` consumer (one whose rows open a detail target through `onRowClick` or
 * `getRowHref`, directly or through a row-behaviour hook) must wire `rowBehaviour.onRowPrefetch`
 * to the shared scheduler (`scheduleDetailPrefetch` from `@/lib/intent-prefetch`) or carry a reasoned
 * exception in `intent-prefetch-exceptions.json`. `DataTable` itself applies the 100 ms intent delay;
 * the consumer callback must route through the shared scheduler for deduplication and bounds.
 * A component that forwards `rowBehaviour` from its props to `DataTable` is a wrapper and must be
 * registered, so its consumers are scanned instead.
 */

export const REGISTERED_DATA_TABLE_WRAPPERS: readonly string[] = []

export type PrefetchException = { file: string; reason: string }

export type PrefetchViolationKind =
  | 'missing-intent-prefetch'
  | 'prefetch-bypasses-scheduler'
  | 'unregistered-wrapper'

export type PrefetchGuardInput = {
  sources: Readonly<Record<string, string>>
  exceptions: readonly PrefetchException[]
  wrappers?: readonly string[]
}

export type PrefetchGuardResult = {
  violations: string[]
  /** Exceptions whose file is gone, no longer navigable, or already wired. */
  staleExceptions: string[]
}

const SCANNED_DIRECTORIES = /^(?:pages|components|features)\//
const SKIPPED_PATHS = /^(?:components\/data-table|components\/ui)\//
/** `const rowBehaviour = ...` or `const { rowBehaviour } = ...`: the behaviour is built here, not received from props. */
const LOCAL_ROW_BEHAVIOUR = /\b(?:const|let)\s+(?:rowBehaviour|\{[^}]*\browBehaviour\b[^}]*\})\s*=/
const ROW_BEHAVIOUR_HOOK = /\buse[A-Z]\w*RowBehaviour\b/g

function violationId(path: string, kind: PrefetchViolationKind): string {
  return `${path}::DataTable::${kind}`
}

function isTagEnd(analyzed: AnalyzedSource, level: number, index: number): boolean {
  return (
    analyzed.code[index] === 1 &&
    analyzed.depth[index] === level &&
    analyzed.masked[index] === '>' &&
    analyzed.masked[index - 1] !== '='
  )
}

function tagEnd(analyzed: AnalyzedSource, start: number): number {
  const level = analyzed.depth[start]!
  let end = start
  while (end < analyzed.masked.length && !isTagEnd(analyzed, level, end)) end += 1
  return end
}

/** Opening-tag texts of `<Name ...>` elements for the given component names. */
function openingTags(analyzed: AnalyzedSource, names: readonly string[]): string[] {
  const pattern = new RegExp(`<(?:${names.join('|')})(?![\\w.])`, 'g')
  return [...analyzed.masked.matchAll(pattern)]
    .map((match) => match.index ?? 0)
    .filter((start) => analyzed.code[start] === 1)
    .map((start) => analyzed.masked.slice(start, tagEnd(analyzed, start) + 1))
}

function declaresHook(text: string, hook: string): boolean {
  return new RegExp(`(?:function\\s+${hook}\\b|const\\s+${hook}\\s*=)`).test(text)
}

/** Source text of row-behaviour hooks the file calls, found anywhere in production source. */
function rowBehaviourHookSources(
  fileText: string,
  sources: Readonly<Record<string, string>>,
): string {
  const hooks = new Set(fileText.match(ROW_BEHAVIOUR_HOOK) ?? [])
  const texts = Object.values(sources)
  return [...hooks]
    .flatMap((hook) => texts.filter((text) => declaresHook(text, hook)).map((text) => analyzeSource(text).masked))
    .join('\n')
}

type FileAnalysis = {
  hasTable: boolean
  navigable: boolean
  forwardsRowBehaviour: boolean
  hasPrefetchCallback: boolean
  usesScheduler: boolean
  masked: string
}

const NAVIGATION_PROP = /\bonRowClick\b|\bgetRowHref\b/

function isNavigable(tags: readonly string[], combinedText: string): boolean {
  const tagNavigates = tags.some((tag) => NAVIGATION_PROP.test(tag))
  const behaviourNavigates =
    tags.some((tag) => /\browBehaviour\s*=/.test(tag)) && NAVIGATION_PROP.test(combinedText)
  return tagNavigates || behaviourNavigates
}

function forwardsRowBehaviour(tags: readonly string[], masked: string): boolean {
  const forwardsProp = (tag: string) =>
    /\browBehaviour\s*=\s*\{\s*(?:props\.)?rowBehaviour\s*\}/.test(tag) && !LOCAL_ROW_BEHAVIOUR.test(masked)
  const spreadsProps = (tag: string) => /\{\s*\.\.\.(?:props|rest)\s*\}/.test(tag)
  return tags.some((tag) => forwardsProp(tag) || spreadsProps(tag))
}

function analyzeFile(
  analyzed: AnalyzedSource,
  tags: readonly string[],
  sources: Readonly<Record<string, string>>,
): FileAnalysis {
  const combined = `${analyzed.masked}\n${rowBehaviourHookSources(analyzed.masked, sources)}`
  return {
    hasTable: tags.length > 0,
    navigable: isNavigable(tags, combined),
    forwardsRowBehaviour: forwardsRowBehaviour(tags, analyzed.masked),
    hasPrefetchCallback: /\bonRowPrefetch\b/.test(combined),
    usesScheduler: /\bscheduleDetailPrefetch\s*\(/.test(combined),
    masked: analyzed.masked,
  }
}

function exportsComponent(source: string, names: readonly string[]): boolean {
  return names.some((name) =>
    new RegExp(`export\\s+(?:default\\s+)?(?:function|const)\\s+${name}\\b`).test(source),
  )
}

function isScannedCandidate(path: string, source: string, wrappers: readonly string[]): boolean {
  if (!/\.tsx$/.test(path) || !SCANNED_DIRECTORIES.test(path) || SKIPPED_PATHS.test(path)) return false
  return source.includes('<DataTable') || wrappers.some((name) => source.includes(`<${name}`))
}

function isWired(analysis: FileAnalysis): boolean {
  return analysis.hasPrefetchCallback && analysis.usesScheduler
}

function fileViolation(
  path: string,
  analysis: FileAnalysis,
  wrappers: readonly string[],
  excepted: ReadonlySet<string>,
): string | undefined {
  if (!analysis.hasTable) return undefined
  if (analysis.forwardsRowBehaviour && !exportsComponent(analysis.masked, wrappers)) {
    return violationId(path, 'unregistered-wrapper')
  }
  if (!analysis.navigable || excepted.has(path) || isWired(analysis)) return undefined
  return violationId(path, analysis.hasPrefetchCallback ? 'prefetch-bypasses-scheduler' : 'missing-intent-prefetch')
}

function analyzeCandidates(
  sources: Readonly<Record<string, string>>,
  wrappers: readonly string[],
): Map<string, FileAnalysis> {
  const tableNames = ['DataTable', ...wrappers]
  const analyses = new Map<string, FileAnalysis>()
  for (const [path, source] of Object.entries(sources)) {
    if (!isScannedCandidate(path, source, wrappers)) continue
    const analyzed = analyzeSource(source)
    analyses.set(path, analyzeFile(analyzed, openingTags(analyzed, tableNames), sources))
  }
  return analyses
}

export function evaluatePrefetchGuard(input: PrefetchGuardInput): PrefetchGuardResult {
  const wrappers = input.wrappers ?? REGISTERED_DATA_TABLE_WRAPPERS
  const excepted = new Set(input.exceptions.map((entry) => entry.file))
  const analyses = analyzeCandidates(input.sources, wrappers)
  const violations = [...analyses.entries()].flatMap(([path, analysis]) => {
    const violation = fileViolation(path, analysis, wrappers, excepted)
    return violation ? [violation] : []
  })
  const staleExceptions = input.exceptions
    .filter((entry) => {
      const analysis = analyses.get(entry.file)
      return !analysis || !analysis.navigable || isWired(analysis)
    })
    .map((entry) => entry.file)
  return { violations: violations.sort(), staleExceptions: staleExceptions.sort() }
}
