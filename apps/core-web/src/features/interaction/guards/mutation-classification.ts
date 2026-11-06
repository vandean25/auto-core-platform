import {
  analyzeSource,
  owningDeclaration,
  skipTypeArguments,
  splitTopLevel,
  topLevelDeclarations,
  type AnalyzedSource,
  type TopLevelDeclaration,
} from './source-text'

/**
 * Mutation-classification guard (ADR-0036 R1, AUT-893).
 *
 * Discovers every `useMutation` call in production source, including alias imports
 * (`useMutation as useRQMutation`), namespace imports (`RQ.useMutation`), local re-bindings and
 * registered wrapper hooks, and reports a violation when the owning hook:
 *  - has no resolvable `mutationKey` (`missing-mutation-key`) or options that cannot be resolved
 *    statically (`unresolved-options`, a review gap rather than a pass),
 *  - has no mutation-inventory entry for its owning hook (`missing-inventory-entry`),
 *  - is classified optimistic/conditional in the inventory but does not use the shared
 *    `optimisticMutationOptions` helper (`optimistic-without-helper`),
 *  - hides `useMutation` behind an unregistered wrapper (`unregistered-wrapper`).
 * Comments are masked before scanning, so a comment is never an exemption.
 */

const RQ_MODULE = '@tanstack/react-query'

export type MutationWrapperRegistry = {
  /** Functions that return mutation options and require `mutationKey` themselves. */
  optionsHelpers: ReadonlyArray<{ name: string; module: string }>
  /** Custom hooks that call `useMutation` for their consumers; consumers are scanned like `useMutation`. */
  hookWrappers: ReadonlyArray<{ name: string; module: string; file: string }>
}

/** Register a wrapper here, with guard coverage, before using it (ADR-0036 enforcement table). */
export const REGISTERED_MUTATION_WRAPPERS: MutationWrapperRegistry = {
  optionsHelpers: [{ name: 'optimisticMutationOptions', module: '@/lib/optimistic-mutation' }],
  hookWrappers: [],
}

export type MutationInventoryRef = {
  owningHook: string
  classification: 'optimistic' | 'server-confirmed' | 'conditional'
  /** Optional disambiguation when two files export the same hook name. */
  sourceFile?: string
}

type MutationViolationKind =
  | 'missing-mutation-key'
  | 'unresolved-options'
  | 'missing-inventory-entry'
  | 'optimistic-without-helper'
  | 'unregistered-wrapper'

type MutationViolation = { path: string; owner: string; kind: MutationViolationKind }

function mutationViolationId({ path, owner, kind }: MutationViolation): string {
  return `${path}::${owner}::${kind}`
}

type Bindings = {
  hookNames: Set<string>
  namespaces: Set<string>
  helperNames: Set<string>
  importRanges: Array<[number, number]>
  /** `useMutation` occurrences that are only part of a local alias declaration. */
  aliasIndexes: Set<number>
  /** Indexes of `export const x = useMutation` declarations: callers elsewhere would bypass the scan. */
  exportedAliasIndexes: number[]
}

type OptionsAnalysis = { hasKey: boolean; usesHelper: boolean; unresolved: boolean }

type MutationSite = {
  path: string
  owner: string
  analysis: OptionsAnalysis
  wrapperEscape: boolean
  /** True for an exported alias / re-export or a registered wrapper's own definition: only the wrapper rule applies. */
  callless?: boolean
}

const IMPORT_PATTERN = /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+(['"])([^'"]+)\2/g
const REEXPORT_PATTERN = /export\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2/g
const IDENTIFIER = '[A-Za-z_$][\\w$]*'
const escapeIdentifier = (name: string) => name.replace(/\$/g, '\\$')

function parseNamedImports(clause: string): Array<{ imported: string; local: string }> {
  const named = /\{([\s\S]*)\}/.exec(clause)?.[1] ?? ''
  return named
    .split(',')
    .map((part) => part.trim().replace(/^type\s+/, ''))
    .filter(Boolean)
    .map((part) => {
      const [imported = '', local] = part.split(/\s+as\s+/)
      return { imported: imported.trim(), local: (local ?? imported).trim() }
    })
}

/** Local names the import clause gives to the export called `name`. */
function localNamesOf(clause: string, name: string): string[] {
  return parseNamedImports(clause)
    .filter(({ imported }) => imported === name)
    .map(({ local }) => local)
}

function bindReactQuery(bindings: Bindings, clause: string): void {
  for (const local of localNamesOf(clause, 'useMutation')) bindings.hookNames.add(local)
  const namespace = new RegExp(`\\*\\s+as\\s+(${IDENTIFIER})`).exec(clause)?.[1]
  if (namespace) bindings.namespaces.add(namespace)
}

function bindRegisteredWrappers(
  bindings: Bindings,
  registry: MutationWrapperRegistry,
  definingFile: string,
  clause: string,
  module: string,
): void {
  for (const wrapper of registry.hookWrappers) {
    if (wrapper.module !== module || wrapper.file === definingFile) continue
    for (const local of localNamesOf(clause, wrapper.name)) bindings.hookNames.add(local)
  }
  for (const helper of registry.optionsHelpers) {
    if (helper.module !== module) continue
    for (const local of localNamesOf(clause, helper.name)) bindings.helperNames.add(local)
  }
}

/** `const run = useMutation` re-binds the hook under another name; calls through the alias are scanned. */
function bindAliases(analyzed: AnalyzedSource, bindings: Bindings): void {
  for (const hook of [...bindings.hookNames]) {
    const rebind = new RegExp(
      `(export\\s+)?(?:const|let)\\s+(${IDENTIFIER})\\s*=\\s*(${escapeIdentifier(hook)})\\s*[;\\n]`,
      'g',
    )
    for (const match of analyzed.masked.matchAll(rebind)) registerAlias(bindings, match)
  }
}

function registerAlias(bindings: Bindings, match: RegExpMatchArray): void {
  const [declaration = '', exported, aliasName = '', hook = ''] = match
  const declarationStart = match.index ?? 0
  const keywordStart = declaration.search(/(?:const|let)\s/)
  const aliasIndex = declarationStart + keywordStart + declaration.slice(keywordStart).indexOf(aliasName)
  const hookIndex = declarationStart + declaration.lastIndexOf(hook)
  bindings.hookNames.add(aliasName)
  bindings.aliasIndexes.add(aliasIndex)
  bindings.aliasIndexes.add(hookIndex)
  if (exported) bindings.exportedAliasIndexes.push(hookIndex)
}

function resolveBindings(
  analyzed: AnalyzedSource,
  registry: MutationWrapperRegistry,
  definingFile: string,
): Bindings {
  const bindings: Bindings = {
    hookNames: new Set(),
    namespaces: new Set(),
    helperNames: new Set(),
    importRanges: [],
    aliasIndexes: new Set(),
    exportedAliasIndexes: [],
  }
  for (const match of analyzed.masked.matchAll(IMPORT_PATTERN)) {
    const [whole, clause = '', , module = ''] = match
    const start = match.index ?? 0
    bindings.importRanges.push([start, start + whole.length])
    if (module === RQ_MODULE) bindReactQuery(bindings, clause)
    bindRegisteredWrappers(bindings, registry, definingFile, clause, module)
  }
  bindAliases(analyzed, bindings)
  return bindings
}

function isInside(ranges: ReadonlyArray<[number, number]>, index: number): boolean {
  return ranges.some(([start, end]) => index >= start && index < end)
}

type CallSite = { nameIndex: number; open: number }

function skipWhitespace(masked: string, index: number): number {
  let next = index
  while (/\s/.test(masked[next] ?? '')) next += 1
  return next
}

function hookReferencePattern(bindings: Bindings): RegExp | undefined {
  const names = [
    ...[...bindings.hookNames].map(escapeIdentifier),
    ...[...bindings.namespaces].map((ns) => `${escapeIdentifier(ns)}\\.useMutation`),
  ]
  return names.length === 0 ? undefined : new RegExp(`(?<![\\w$.])(?:${names.join('|')})(?![\\w$])`, 'g')
}

/** Calls of a mutation hook, and bare references (`export const x = useMutation`) that bypass the scan. */
function findHookCalls(
  analyzed: AnalyzedSource,
  bindings: Bindings,
): { calls: CallSite[]; escapes: number[] } {
  const calls: CallSite[] = []
  const escapes: number[] = []
  const pattern = hookReferencePattern(bindings)
  for (const match of pattern ? analyzed.masked.matchAll(pattern) : []) {
    const index = match.index ?? 0
    if (!isScannableReference(analyzed, bindings, index)) continue
    const open = skipWhitespace(analyzed.masked, skipTypeArguments(analyzed.masked, index + match[0].length))
    if (analyzed.masked[open] === '(') calls.push({ nameIndex: index, open })
    else escapes.push(index)
  }
  return { calls, escapes }
}

function isScannableReference(analyzed: AnalyzedSource, bindings: Bindings, index: number): boolean {
  return (
    analyzed.code[index] === 1 &&
    !isInside(bindings.importRanges, index) &&
    !bindings.aliasIndexes.has(index)
  )
}

function declarationInit(analyzed: AnalyzedSource, name: string): number | undefined {
  const pattern = new RegExp(`(?:const|let)\\s+${escapeIdentifier(name)}\\b[^=\\n]*=\\s*`, 'g')
  for (const match of analyzed.masked.matchAll(pattern)) {
    if (analyzed.code[match.index ?? 0]) return (match.index ?? 0) + match[0].length
  }
  return undefined
}

function functionBodyRange(
  analyzed: AnalyzedSource,
  declarations: readonly TopLevelDeclaration[],
  name: string,
): [number, number] | undefined {
  const index = declarations.findIndex((declaration) => declaration.name === name)
  if (index === -1) return undefined
  return [declarations[index]!.start, declarations[index + 1]?.start ?? analyzed.masked.length]
}

type Context = {
  analyzed: AnalyzedSource
  bindings: Bindings
  declarations: readonly TopLevelDeclaration[]
  ownerParams: string
}

const NOT_RESOLVED: OptionsAnalysis = { hasKey: false, usesHelper: false, unresolved: true }

function mergeAnalysis(a: OptionsAnalysis, b: OptionsAnalysis): OptionsAnalysis {
  return {
    hasKey: a.hasKey || b.hasKey,
    usesHelper: a.usesHelper || b.usesHelper,
    unresolved: a.unresolved || b.unresolved,
  }
}

function analyzeFunctionBody(ctx: Context, name: string): OptionsAnalysis | undefined {
  const range = functionBodyRange(ctx.analyzed, ctx.declarations, name)
  if (!range) return undefined
  const body = ctx.analyzed.masked.slice(...range)
  const helpers = [...ctx.bindings.helperNames].map(escapeIdentifier)
  const usesHelper = helpers.length > 0 && new RegExp(`(?<![\\w$.])(?:${helpers.join('|')})\\b`).test(body)
  const hasKey = usesHelper || /\bmutationKey\s*[:,}]/.test(body)
  return { hasKey, usesHelper, unresolved: !hasKey }
}

function readIdentifier(masked: string, index: number): string | undefined {
  return new RegExp(`^(${IDENTIFIER})`).exec(masked.slice(index, index + 80))?.[1]
}

/** Resolves what the options expression starting at `start` provides, following same-file declarations. */
function analyzeExpression(ctx: Context, start: number, budget: number): OptionsAnalysis {
  const { masked } = ctx.analyzed
  const index = skipWhitespace(masked, start)
  if (masked[index] === '{') return analyzeObject(ctx, index, budget)
  const identifier = readIdentifier(masked, index)
  if (!identifier) return NOT_RESOLVED
  const next = skipWhitespace(masked, skipTypeArguments(masked, index + identifier.length))
  return masked[next] === '('
    ? analyzeCalledFunction(ctx, identifier, budget)
    : analyzeReference(ctx, identifier, budget)
}

function analyzeCalledFunction(ctx: Context, name: string, budget: number): OptionsAnalysis {
  if (ctx.bindings.helperNames.has(name)) return { hasKey: true, usesHelper: true, unresolved: false }
  return (budget > 0 ? analyzeFunctionBody(ctx, name) : undefined) ?? NOT_RESOLVED
}

function analyzeReference(ctx: Context, name: string, budget: number): OptionsAnalysis {
  const init = budget > 0 ? declarationInit(ctx.analyzed, name) : undefined
  return init === undefined ? NOT_RESOLVED : analyzeExpression(ctx, init, budget - 1)
}

function analyzeMember(ctx: Context, member: string, memberStart: number, budget: number): OptionsAnalysis | undefined {
  if (/^mutationKey\s*(?::|$)/.test(member)) return { hasKey: true, usesHelper: false, unresolved: false }
  if (!member.startsWith('...')) return undefined
  return analyzeExpression(ctx, ctx.analyzed.masked.indexOf('...', memberStart) + 3, budget)
}

function analyzeObject(ctx: Context, open: number, budget: number): OptionsAnalysis {
  let result: OptionsAnalysis = { hasKey: false, usesHelper: false, unresolved: false }
  for (const [start, end] of splitTopLevel(ctx.analyzed, open)) {
    const member = ctx.analyzed.masked.slice(start, end).trim()
    const analysis = analyzeMember(ctx, member, start, budget)
    if (analysis) result = mergeAnalysis(result, analysis)
  }
  // An unresolved spread only matters while no key was found anywhere in the options.
  return { ...result, unresolved: result.unresolved && !result.hasKey }
}

function isOwnerParameter(ownerParams: string, expression: string): boolean {
  const name = readIdentifier(expression.trim().replace(/^\.\.\./, ''), 0)
  return name !== undefined && new RegExp(`(?<![\\w$])${escapeIdentifier(name)}(?![\\w$])`).test(ownerParams)
}

/** True when the call hands the owner's own parameter (or a spread of it) to `useMutation`. */
function passesParameterThrough(ctx: Context, first: [number, number], analysis: OptionsAnalysis): boolean {
  const text = ctx.analyzed.masked.slice(...first)
  if (!/^\s*\{/.test(text)) return isOwnerParameter(ctx.ownerParams, text)
  const members = splitTopLevel(ctx.analyzed, ctx.analyzed.masked.indexOf('{', first[0]))
  const spreadsParameter = members.some(([start, end]) => {
    const member = ctx.analyzed.masked.slice(start, end).trim()
    return member.startsWith('...') && isOwnerParameter(ctx.ownerParams, member)
  })
  return spreadsParameter && !analysis.hasKey
}

function isHookOrComponentName(name: string): boolean {
  return /^use[A-Z0-9]/.test(name) || /^[A-Z]/.test(name)
}

type FileScan = {
  path: string
  analyzed: AnalyzedSource
  bindings: Bindings
  declarations: readonly TopLevelDeclaration[]
  registry: MutationWrapperRegistry
}

function isRegisteredWrapperDefinition(scan: FileScan, owner: string): boolean {
  return scan.registry.hookWrappers.some((wrapper) => wrapper.file === scan.path && wrapper.name === owner)
}

function callSite(scan: FileScan, call: CallSite): MutationSite {
  const ownerDeclaration = owningDeclaration(scan.declarations, call.nameIndex)
  const owner = ownerDeclaration?.name ?? '<module>'
  const ctx: Context = {
    analyzed: scan.analyzed,
    bindings: scan.bindings,
    declarations: scan.declarations,
    ownerParams: ownerDeclaration?.params ?? '',
  }
  const [first] = splitTopLevel(scan.analyzed, call.open)
  const analysis = first ? analyzeExpression(ctx, first[0], 3) : NOT_RESOLVED
  const registeredWrapper = isRegisteredWrapperDefinition(scan, owner)
  const passThrough = first !== undefined && passesParameterThrough(ctx, first, analysis)
  return {
    path: scan.path,
    owner,
    analysis,
    wrapperEscape: !registeredWrapper && (passThrough || !isHookOrComponentName(owner)),
    callless: registeredWrapper,
  }
}

/** `export const useX = useMutation` or passing `useMutation` around as a value: an escape without a call. */
function escapeSite(scan: FileScan, index: number): MutationSite {
  const owner = owningDeclaration(scan.declarations, index)?.name ?? '<module>'
  return { path: scan.path, owner, analysis: NOT_RESOLVED, wrapperEscape: true, callless: true }
}

/** `export { useMutation as useApiMutation } from '@tanstack/react-query'` */
function reexportSites(scan: FileScan): MutationSite[] {
  return [...scan.analyzed.masked.matchAll(REEXPORT_PATTERN)]
    .filter((match) => match[3] === RQ_MODULE && /\buseMutation\b/.test(match[1] ?? ''))
    .map(() => ({
      path: scan.path,
      owner: '<reexport>',
      analysis: NOT_RESOLVED,
      wrapperEscape: true,
      callless: true,
    }))
}

/** Finds every mutation call site in one source file. */
function scanMutationSites(
  path: string,
  source: string,
  registry: MutationWrapperRegistry = REGISTERED_MUTATION_WRAPPERS,
): MutationSite[] {
  if (!/useMutation|optimisticMutationOptions/.test(source) && registry.hookWrappers.length === 0) {
    return []
  }
  const analyzed = analyzeSource(source)
  const bindings = resolveBindings(analyzed, registry, path)
  const scan: FileScan = { path, analyzed, bindings, declarations: topLevelDeclarations(analyzed), registry }
  const { calls, escapes } = findHookCalls(analyzed, bindings)
  return [
    ...calls.map((call) => callSite(scan, call)),
    ...[...escapes, ...bindings.exportedAliasIndexes].map((index) => escapeSite(scan, index)),
    ...reexportSites(scan),
  ]
}

type MutationGuardInput = {
  sources: Readonly<Record<string, string>>
  inventory: readonly MutationInventoryRef[]
  registry?: MutationWrapperRegistry
  /** Hooks the AUT-894 `mutation-key.baseline.json` already covers; those keys are not re-baselined here. */
  pilotMissingKeyHooks?: ReadonlySet<string>
  pilotFiles?: ReadonlySet<string>
}

type MutationGuardResult = {
  violations: string[]
  /** Inventory entries that match no scanned hook; a rename must update the inventory. */
  orphanInventoryEntries: string[]
}

function inventoryFor(
  inventory: readonly MutationInventoryRef[],
  site: Pick<MutationSite, 'path' | 'owner'>,
): MutationInventoryRef | undefined {
  return inventory.find(
    (entry) => entry.owningHook === site.owner && (!entry.sourceFile || entry.sourceFile === site.path),
  )
}

function isCoveredByPilotBaseline(input: MutationGuardInput, site: MutationSite): boolean {
  return input.pilotFiles?.has(site.path) === true && input.pilotMissingKeyHooks?.has(site.owner) === true
}

function keyViolations(input: MutationGuardInput, site: MutationSite): MutationViolation[] {
  if (site.analysis.hasKey || isCoveredByPilotBaseline(input, site)) return []
  const unresolved = site.analysis.unresolved && !site.wrapperEscape
  const kind = unresolved ? 'unresolved-options' : 'missing-mutation-key'
  return [{ path: site.path, owner: site.owner, kind }]
}

function siteViolations(input: MutationGuardInput, site: MutationSite): MutationViolation[] {
  const base = { path: site.path, owner: site.owner }
  const wrapper: MutationViolation[] = site.wrapperEscape ? [{ ...base, kind: 'unregistered-wrapper' }] : []
  if (site.callless) return wrapper
  const inventory: MutationViolation[] = inventoryFor(input.inventory, site)
    ? []
    : [{ ...base, kind: 'missing-inventory-entry' }]
  return [...wrapper, ...keyViolations(input, site), ...inventory]
}

/** Optimistic or conditional inventory entries must trace to the shared helper in the hook's source. */
function untracedOptimisticViolations(
  input: MutationGuardInput,
  sites: readonly MutationSite[],
): MutationViolation[] {
  const usesHelper = new Map<string, MutationSite>()
  for (const site of sites) {
    const key = `${site.path}\u0000${site.owner}`
    const known = usesHelper.get(key)
    if (!known || site.analysis.usesHelper) usesHelper.set(key, site)
  }
  return [...usesHelper.values()]
    .filter((site) => !site.analysis.usesHelper)
    .filter((site) => {
      const entry = inventoryFor(input.inventory, site)
      return entry !== undefined && entry.classification !== 'server-confirmed'
    })
    .map((site) => ({ path: site.path, owner: site.owner, kind: 'optimistic-without-helper' as const }))
}

function allSites(input: MutationGuardInput): MutationSite[] {
  const registry = input.registry ?? REGISTERED_MUTATION_WRAPPERS
  return Object.entries(input.sources)
    .filter(([path]) => /\.tsx?$/.test(path))
    .flatMap(([path, source]) => scanMutationSites(path, source, registry))
}

export function evaluateMutationGuard(input: MutationGuardInput): MutationGuardResult {
  const sites = allSites(input)
  const seenOwners = new Set(sites.map((site) => site.owner))
  const violations = [
    ...sites.flatMap((site) => siteViolations(input, site)),
    ...untracedOptimisticViolations(input, sites),
  ]
  return {
    violations: violations.map(mutationViolationId).sort(),
    orphanInventoryEntries: input.inventory
      .filter((entry) => !seenOwners.has(entry.owningHook))
      .map((entry) => entry.owningHook)
      .sort(),
  }
}
