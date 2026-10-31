// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { isRegisteredEntityActionId } from './entity-action'
import baseline from './registry-parity.baseline.json'

/**
 * Product scope exclusions (Dejan decision, 2026-10-23: "settings/admin and mechanic
 * touch UI out of scope" for Cmd+K action parity).
 * `pages/platform/PlatformTenantsPage.tsx` is the platform-admin tenant config screen
 * and is treated as admin configuration.
 * `features/actions/RegistryActionButton.tsx` is the shared page-button primitive that
 * forwards `data-action-id={action.id}` to the underlying `<Button>`.
 */
const EXCLUDED_EXACT_PATHS = new Set<string>([
  'pages/SettingsPage.tsx',
  'pages/settings-page-content.tsx',
  'pages/settings-finance-tab.tsx',
  'pages/platform/PlatformTenantsPage.tsx',
  'features/actions/RegistryActionButton.tsx',
])

const EXCLUDED_PATH_PREFIXES = [
  'pages/mechanic/',
  'features/mechanic-task-detail/',
] as const

const NON_PRODUCTION_FILE_PATTERN = /\.(?:test|spec|stories|testUtils)\.|\/__tests__\//
const FOOTER_TAG_PATTERN = /<(\/?)(?:DialogFooter|AlertDialogFooter|SheetFooter)\b/g
const CANDIDATE_TAG_PATTERN = /<\s*(Button|DropdownMenuItem|AlertDialogTrigger)\b/g
// Dynamic `data-action-id={...}` expressions (non-string-literal) cannot be resolved statically and count as compliant.
const LITERAL_ACTION_ID_PATTERN =
  /\bdata-action-id\s*=\s*(?:["']([^"']*)["']|\{\s*["']([^"']*)["']\s*\})/g
const QUOTE_CHARS = new Set(['"', "'", '`'])

const rawSources: Record<string, string> = {
  ...import.meta.glob<string>('../../pages/**/*.tsx', {
    query: '?raw',
    eager: true,
    import: 'default',
  }),
  ...import.meta.glob<string>('../**/*.tsx', {
    query: '?raw',
    eager: true,
    import: 'default',
  }),
}

function toSrcRelativePath(globKey: string): string {
  if (globKey.startsWith('../../pages/')) return globKey.slice('../../'.length)
  if (globKey.startsWith('../')) return `features/${globKey.slice('../'.length)}`
  return globKey.replace(/^\/?src\//, '')
}

function isScannedProductionFile(relativePath: string): boolean {
  if (NON_PRODUCTION_FILE_PATTERN.test(relativePath)) return false
  if (EXCLUDED_EXACT_PATHS.has(relativePath)) return false
  return !EXCLUDED_PATH_PREFIXES.some((prefix) => relativePath.startsWith(prefix))
}

/**
 * Checks whether `offset` falls inside an open `<DialogFooter>`, `<AlertDialogFooter>`,
 * or `<SheetFooter>` block in the same file.
 * shortcut: counts opening/closing footer tags in the same file, upgrade if footer wrappers are split across files.
 */
function isInsideDialogFooter(source: string, offset: number): boolean {
  let depth = 0
  for (const match of source.slice(0, offset).matchAll(FOOTER_TAG_PATTERN)) {
    depth += match[1] === '/' ? -1 : 1
  }
  return depth > 0
}

function skipQuoted(source: string, start: number, quote: string): number {
  let index = start + 1
  while (index < source.length && source[index] !== quote) {
    index += source[index] === '\\' ? 2 : 1
  }
  return index
}

function readOpeningTag(source: string, startIndex: number): string {
  let braceDepth = 0
  for (let i = startIndex; i < source.length; i += 1) {
    const ch = source[i]
    if (QUOTE_CHARS.has(ch)) i = skipQuoted(source, i, ch)
    else if (ch === '{') braceDepth += 1
    else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1)
    else if (ch === '>' && braceDepth === 0) return source.slice(startIndex, i + 1)
  }
  return source.slice(startIndex)
}

function readBracedExpression(text: string, openBraceIndex: number): string {
  let depth = 0
  for (let i = openBraceIndex; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') {
      depth -= 1
      if (depth === 0) return text.slice(openBraceIndex + 1, i)
    }
  }
  return text.slice(openBraceIndex + 1)
}

function extractShortIdentifier(source: string, tagOffset: number, openingTag: string): string {
  const onClickMatch = /\bonClick\s*=\s*\{/.exec(openingTag)
  if (onClickMatch) {
    const expr = readBracedExpression(openingTag, onClickMatch.index + onClickMatch[0].length - 1)
    const normalized = expr.replace(/\s+/g, ' ').trim().replace(/^\(\)\s*=>\s*/, '')
    return normalized.slice(0, 60) || 'onClick'
  }
  const afterTag = source.slice(tagOffset + openingTag.length, tagOffset + openingTag.length + 400)
  const i18nMatch = /\bt\(\s*(['"][^'"]+['"])/.exec(afterTag)
  if (i18nMatch) return `t(${i18nMatch[1]})`
  const innerMatch = /^([\s\S]*?)<\/AlertDialogTrigger\b/.exec(afterTag)
  const stripped = (innerMatch?.[1] ?? openingTag)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return stripped.slice(0, 60) || 'trigger'
}

function scanFileMissingActionIds(relativePath: string, source: string): string[] {
  const violations: string[] = []
  for (const match of source.matchAll(CANDIDATE_TAG_PATTERN)) {
    const tagName = match[1]
    const offset = match.index
    if (isInsideDialogFooter(source, offset)) continue
    const openingTag = readOpeningTag(source, offset)
    if (tagName !== 'AlertDialogTrigger' && !/\bonClick\s*=/.test(openingTag)) continue
    if (/\bdata-action-id\s*=/.test(openingTag)) continue
    const identifier = extractShortIdentifier(source, offset, openingTag)
    violations.push(`${relativePath}::${tagName}::${identifier}`)
  }
  return violations
}

function scanFileUnregisteredActionIds(relativePath: string, source: string): string[] {
  const unregistered: string[] = []
  for (const match of source.matchAll(LITERAL_ACTION_ID_PATTERN)) {
    const actionId = match[1] ?? match[2] ?? ''
    if (!isRegisteredEntityActionId(actionId)) {
      unregistered.push(`${relativePath}::data-action-id::${actionId}`)
    }
  }
  return unregistered
}

function scanRegistryParitySources(sources: Record<string, string>) {
  const violations: string[] = []
  const unregisteredActionIds: string[] = []

  for (const [rawKey, source] of Object.entries(sources)) {
    const relativePath = toSrcRelativePath(rawKey)
    if (!isScannedProductionFile(relativePath)) continue
    violations.push(...scanFileMissingActionIds(relativePath, source))
    unregisteredActionIds.push(...scanFileUnregisteredActionIds(relativePath, source))
  }

  return {
    violations: violations.sort(),
    unregisteredActionIds: unregisteredActionIds.sort(),
  }
}

function countEntries(items: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of items) {
    counts.set(item, (counts.get(item) ?? 0) + 1)
  }
  return counts
}

function subtractCounts(
  left: ReadonlyMap<string, number>,
  right: ReadonlyMap<string, number>,
): string[] {
  const result: string[] = []
  for (const [key, count] of left) {
    const extra = count - (right.get(key) ?? 0)
    for (let i = 0; i < extra; i += 1) result.push(key)
  }
  return result.sort()
}

function diffBaselineViolations(current: readonly string[], expectedBaseline: readonly string[]) {
  const currentCounts = countEntries(current)
  const baselineCounts = countEntries(expectedBaseline)
  return {
    added: subtractCounts(currentCounts, baselineCounts),
    stale: subtractCounts(baselineCounts, currentCounts),
  }
}

describe('registry-parity scanner (inline fixtures)', () => {
  it('flags a new onClick Button, DropdownMenuItem, or AlertDialogTrigger without data-action-id', () => {
    const result = scanRegistryParitySources({
      'pages/orders/OrderPage.tsx': `
        export function OrderPage() {
          return (
            <div>
              <Button onClick={() => archiveOrder(id)}>Archive</Button>
              <DropdownMenuItem onClick={handleDuplicate}>Duplicate</DropdownMenuItem>
              <AlertDialogTrigger asChild>
                <Button>{t('orders.delete')}</Button>
              </AlertDialogTrigger>
            </div>
          )
        }
      `,
    })

    expect(result.violations).toEqual([
      "pages/orders/OrderPage.tsx::AlertDialogTrigger::t('orders.delete')",
      'pages/orders/OrderPage.tsx::Button::archiveOrder(id)',
      'pages/orders/OrderPage.tsx::DropdownMenuItem::handleDuplicate',
    ])
    expect(result.unregisteredActionIds).toEqual([])
  })

  it('flags an unregistered literal data-action-id and accepts registered or dynamic ids and RegistryActionButton', () => {
    const result = scanRegistryParitySources({
      'pages/customers/CustomerCard.tsx': `
        export function CustomerCard() {
          return (
            <div>
              <Button data-action-id="customer.delete" onClick={handleDelete}>Delete</Button>
              <Button data-action-id={action.id} onClick={handleDynamic}>Dynamic</Button>
              <RegistryActionButton action={deleteAction} record={customer} runContext={ctx} role={role} />
              <Button data-action-id="customer.nope" onClick={handleNope}>Nope</Button>
            </div>
          )
        }
      `,
    })

    expect(result.violations).toEqual([])
    expect(result.unregisteredActionIds).toEqual([
      'pages/customers/CustomerCard.tsx::data-action-id::customer.nope',
    ])
  })

  it('excludes buttons inside DialogFooter, AlertDialogFooter, and SheetFooter', () => {
    const result = scanRegistryParitySources({
      'pages/customers/CustomerModal.tsx': `
        export function CustomerModal() {
          return (
            <div>
              <DialogFooter>
                <Button onClick={onCancel}>Cancel</Button>
              </DialogFooter>
              <AlertDialogFooter>
                <Button onClick={onConfirm}>Confirm</Button>
              </AlertDialogFooter>
              <SheetFooter>
                <Button onClick={onClose}>Close</Button>
              </SheetFooter>
            </div>
          )
        }
      `,
    })

    expect(result.violations).toEqual([])
  })

  it('excludes settings/admin config paths, mechanic touch UI paths, and non-production files', () => {
    const result = scanRegistryParitySources({
      'pages/SettingsPage.tsx': '<Button onClick={save}>Save</Button>',
      'pages/settings-page-content.tsx': '<Button onClick={save}>Save</Button>',
      'pages/settings-finance-tab.tsx': '<Button onClick={save}>Save</Button>',
      'pages/platform/PlatformTenantsPage.tsx': '<Button onClick={save}>Save</Button>',
      'pages/mechanic/MechanicQueuePage.tsx': '<Button onClick={punch}>Punch</Button>',
      'features/mechanic-task-detail/MechanicTaskDetailView.tsx':
        '<Button onClick={pause}>Pause</Button>',
      'features/actions/RegistryActionButton.tsx': '<Button onClick={run}>Run</Button>',
      'pages/customers/CustomerList.test.tsx': '<Button onClick={noop}>Test</Button>',
    })

    expect(result.violations).toEqual([])
  })

  it('ratchets both newly added violations and stale removed baseline entries (including duplicate counts)', () => {
    const base = [
      'pages/a.tsx::Button::save',
      'pages/a.tsx::Button::save',
      'pages/b.tsx::Button::oldAction',
    ]
    const current = [
      'pages/a.tsx::Button::save',
      'pages/c.tsx::Button::newAction',
    ]

    expect(diffBaselineViolations(current, base)).toEqual({
      added: ['pages/c.tsx::Button::newAction'],
      stale: ['pages/a.tsx::Button::save', 'pages/b.tsx::Button::oldAction'],
    })
  })
})

describe('src/pages and src/features action registry parity guard', () => {
  const scanResult = scanRegistryParitySources(rawSources)

  it('resolves every literal data-action-id in pages/ and features/ to a registered entity action id', () => {
    expect(
      scanResult.unregisteredActionIds,
      'Every literal data-action-id must be registered in ENTITY_ACTION_IDS (src/features/actions/entity-action.ts).',
    ).toEqual([])
  })

  it('matches the ratcheting baseline (no new page-only actions; remove migrated entries from registry-parity.baseline.json)', () => {
    const { added, stale } = diffBaselineViolations(scanResult.violations, baseline)

    expect(
      added,
      'New page-only actions found without data-action-id. Render them with RegistryActionButton or add a registered data-action-id.',
    ).toEqual([])
    expect(
      stale,
      'Stale baseline entries no longer occur in source. Remove these lines from src/features/actions/registry-parity.baseline.json.',
    ).toEqual([])
  })
})
