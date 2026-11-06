import type { ShortcutScope } from '@/features/shortcuts/shortcut-dispatcher'

/**
 * Shortcut parity model (ADR-0036 R5, AUT-893): which single keys can be live at the same time and
 * who wins. The dispatcher runs scopes in `precedence` order and the first handler that consumes a
 * key stops it, so two scopes sharing a key silently hide the lower one. Parity therefore requires:
 *  - `duplicate`: no key twice within one row surface (or within a group of surfaces that can be
 *    mounted at once) and none twice among the global plain keys,
 *  - `reserved`: registry `shortcutKey`s are one character and not dispatcher-owned,
 *  - `shadows-global`: a row key never equals a global plain key or a `g`-sequence second key, because
 *    the higher-precedence row scope would swallow the global action,
 *  - `precedence`: row must outrank global, as the shortcut sheet and `Cmd+K` parity assume.
 * Unrelated row surfaces (different lists on different pages) may reuse a key.
 */
export type ShortcutParityModel = {
  /** Registry actions per list surface (top-level definitions; children cannot carry shortcut keys). */
  rowSurfaces: Readonly<Record<string, ReadonlyArray<{ id: string; shortcutKey?: string }>>>
  /** Groups of row surfaces that can be mounted on one page at the same time. */
  simultaneousGroups: ReadonlyArray<readonly string[]>
  /** Keys the shared data table owns in the row scope. */
  dataTableKeys: readonly string[]
  /** Plain global keys, and the second keys of `g` sequences. */
  globalKeys: readonly string[]
  sequenceSecondKeys: readonly string[]
  /** Keys no registry action may use. */
  reservedKeys: readonly string[]
  precedence: readonly ShortcutScope[]
}

function normalize(key: string | undefined): string | undefined {
  return key?.toLowerCase()
}

function duplicateKeys(keys: readonly string[]): string[] {
  return keys.filter((key, index) => keys.indexOf(key) !== index)
}

function surfaceKeys(model: ShortcutParityModel, surface: string): string[] {
  return (model.rowSurfaces[surface] ?? []).flatMap((action) => {
    const key = normalize(action.shortcutKey)
    return key ? [key] : []
  })
}

function precedenceConflicts(model: ShortcutParityModel): string[] {
  const rowFirst = model.precedence.indexOf('row') === 0 && model.precedence.indexOf('global') === 1
  return rowFirst ? [] : [`dispatcher::precedence::${model.precedence.join('>')}`]
}

function globalDuplicateConflicts(model: ShortcutParityModel): string[] {
  return duplicateKeys(model.globalKeys.map((key) => key.toLowerCase())).map(
    (key) => `global::duplicate::${key}`,
  )
}

function isReserved(model: ShortcutParityModel, key: string): boolean {
  return key.length !== 1 || model.reservedKeys.includes(key) || model.dataTableKeys.includes(key)
}

function shadowsGlobal(model: ShortcutParityModel, key: string): boolean {
  return model.globalKeys.includes(key) || model.sequenceSecondKeys.includes(key)
}

function keyConflicts(model: ShortcutParityModel, surface: string, key: string): string[] {
  return [
    ...(isReserved(model, key) ? [`row:${surface}::reserved::${key}`] : []),
    ...(shadowsGlobal(model, key) ? [`row:${surface}::shadows-global::${key}`] : []),
  ]
}

function surfaceConflicts(model: ShortcutParityModel, surface: string): string[] {
  const keys = surfaceKeys(model, surface)
  return [
    ...duplicateKeys(keys).map((key) => `row:${surface}::duplicate::${key}`),
    ...[...new Set(keys)].flatMap((key) => keyConflicts(model, surface, key)),
  ]
}

function groupConflicts(model: ShortcutParityModel): string[] {
  return model.simultaneousGroups.flatMap((group) => {
    const keys = group.flatMap((surface) => [...new Set(surfaceKeys(model, surface))])
    return duplicateKeys(keys).map((key) => `row:${group.join('+')}::duplicate::${key}`)
  })
}

export function findShortcutConflicts(model: ShortcutParityModel): string[] {
  return [
    ...precedenceConflicts(model),
    ...globalDuplicateConflicts(model),
    ...Object.keys(model.rowSurfaces).flatMap((surface) => surfaceConflicts(model, surface)),
    ...groupConflicts(model),
  ].sort()
}
