// @vitest-environment node
import { describe, expect, it } from 'vitest'

import type { TFunction } from 'i18next'

import { diffBaseline } from '@/features/interaction/guards/baseline-ratchet'
import { UPDATE_BASELINES, writeGuardBaseline } from '@/features/interaction/guards/baseline-files'
import { productionSources } from '@/features/interaction/guards/production-sources'
import { analyzeSource } from '@/features/interaction/guards/source-text'
import { SECOND_KEY_PATHS } from '@/features/shortcuts/use-g-sequence-navigation'
import { SHORTCUT_SCOPE_PRECEDENCE } from '@/features/shortcuts/shortcut-dispatcher'
import {
  DATA_TABLE_ROW_KEYS,
  GLOBAL_PLAIN_KEYS,
  RESERVED_SINGLE_KEYS,
} from '@/features/shortcuts/shortcut-constants'
import { createCustomerRowActions } from './customer-row-actions'
import { isRegisteredEntityActionId } from './entity-action'
import { createEstimateRowActions } from './estimate-row-actions'
import baseline from './registry-parity.baseline.json'
import shortcutBaseline from './registry-parity.shortcuts.baseline.json'
import { findShortcutConflicts, type ShortcutParityModel } from './shortcut-parity'
import { createVehicleRowActions } from './vehicle-row-actions'
import { createWorkshopOrderRowActions } from './work-order-row-actions'

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

    expect(diffBaseline(current, base)).toEqual({
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
    const { added, stale } = diffBaseline(scanResult.violations, baseline)

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

// ---------------------------------------------------------------------------
// Shortcut parity (ADR-0036 R5, AUT-893): scopes, reserved keys, simultaneous availability, precedence.
// ---------------------------------------------------------------------------

const t = ((key: string) => key) as unknown as TFunction<never>

/** Each registry list is its own row surface; keys must be unique within it. */
const REAL_ROW_SURFACES = {
  customers: createCustomerRowActions(t as never),
  vehicles: createVehicleRowActions(t as never),
  estimates: createEstimateRowActions(t as never),
  workOrders: createWorkshopOrderRowActions(t as never),
}

/**
 * Row surfaces that can be mounted on one page at the same time. None of today's registry lists share
 * a page, so each is checked alone; add a group here when a page embeds two lists.
 */
const REAL_SIMULTANEOUS_GROUPS: ReadonlyArray<readonly string[]> = []

/** The only files allowed to register dispatcher handlers; a new site must extend the parity model. */
const SHORTCUT_HANDLER_SITES: Readonly<Record<string, 'row' | 'global'>> = {
  'components/data-table/use-data-table-row-shortcuts.ts': 'row',
  'features/shortcuts/use-registry-row-shortcuts.ts': 'row',
  'features/shortcuts/GlobalShortcutLayer.tsx': 'global',
  'features/shortcuts/use-g-sequence-navigation.ts': 'global',
}

const HANDLER_CALL_PATTERN = /\buseShortcutHandler\(\s*(['"])(row|global)\1/g
const PLAIN_HOTKEY_PATTERN = /\buseHotkeys\(\s*(['"])([^'"+]+)\1/g

function findShortcutRegistrationViolations(sources: Record<string, string>): string[] {
  const violations: string[] = []
  for (const [path, source] of Object.entries(sources)) {
    const masked = analyzeSource(source).masked
    for (const match of masked.matchAll(HANDLER_CALL_PATTERN)) {
      if (SHORTCUT_HANDLER_SITES[path] !== match[2]) {
        violations.push(`${path}::useShortcutHandler(${match[2]})::unregistered-site`)
      }
    }
    for (const match of masked.matchAll(PLAIN_HOTKEY_PATTERN)) {
      violations.push(`${path}::useHotkeys::${match[2]}`)
    }
  }
  return violations.sort()
}

function realShortcutModel(): ShortcutParityModel {
  return {
    rowSurfaces: REAL_ROW_SURFACES,
    simultaneousGroups: REAL_SIMULTANEOUS_GROUPS,
    dataTableKeys: DATA_TABLE_ROW_KEYS,
    globalKeys: GLOBAL_PLAIN_KEYS,
    sequenceSecondKeys: Object.keys(SECOND_KEY_PATHS),
    reservedKeys: RESERVED_SINGLE_KEYS,
    precedence: SHORTCUT_SCOPE_PRECEDENCE,
  }
}

const FIXTURE_MODEL: ShortcutParityModel = {
  rowSurfaces: {
    customers: [
      { id: 'customer.open', shortcutKey: 'o' },
      { id: 'customer.edit', shortcutKey: 'e' },
    ],
    vehicles: [{ id: 'vehicle.open', shortcutKey: 'o' }],
  },
  simultaneousGroups: [],
  dataTableKeys: ['j', 'k', 'x'],
  globalKeys: ['j', '?', 'g'],
  sequenceSecondKeys: ['w', 'c', 'v'],
  reservedKeys: ['j', 'k', 'x', 'g', '?'],
  precedence: ['row', 'global'],
}

function withSurface(
  rowSurfaces: ShortcutParityModel['rowSurfaces'],
  overrides: Partial<ShortcutParityModel> = {},
): ShortcutParityModel {
  return { ...FIXTURE_MODEL, rowSurfaces, ...overrides }
}

describe('shortcut parity (ADR-0036 R5)', () => {
  it('fails when two actions share a shortcutKey in one active row scope', () => {
    const conflicts = findShortcutConflicts(
      withSurface({
        customers: [
          { id: 'customer.open', shortcutKey: 'o' },
          { id: 'customer.call', shortcutKey: 'O' },
        ],
      }),
    )

    expect(conflicts).toEqual(['row:customers::duplicate::o'])
  })

  it('lets separate list surfaces reuse a key while their pages never mount together', () => {
    expect(findShortcutConflicts(FIXTURE_MODEL)).toEqual([])
  })

  it.each([
    {
      name: 'a dispatcher-owned row key',
      surfaces: { customers: [{ id: 'customer.pick', shortcutKey: 'x' }] },
      expected: ['row:customers::reserved::x'],
    },
    {
      name: 'a multi-character key',
      surfaces: { customers: [{ id: 'customer.pick', shortcutKey: 'ab' }] },
      expected: ['row:customers::reserved::ab'],
    },
    {
      name: 'a g-sequence second key the row scope would swallow',
      surfaces: { customers: [{ id: 'customer.workshop', shortcutKey: 'w' }] },
      expected: ['row:customers::shadows-global::w'],
    },
    {
      name: 'a global plain key',
      surfaces: { customers: [{ id: 'customer.help', shortcutKey: '?' }] },
      expected: ['row:customers::reserved::?', 'row:customers::shadows-global::?'],
    },
  ])('fails for $name', ({ surfaces, expected }) => {
    expect(findShortcutConflicts(withSurface(surfaces))).toEqual(expected)
  })

  it('fails when two lists that can be mounted at once share a key', () => {
    const conflicts = findShortcutConflicts({
      ...FIXTURE_MODEL,
      simultaneousGroups: [['customers', 'vehicles']],
    })

    expect(conflicts).toEqual(['row:customers+vehicles::duplicate::o'])
  })

  it('fails when the global scope outranks the row scope or repeats a key', () => {
    expect(findShortcutConflicts({ ...FIXTURE_MODEL, precedence: ['global', 'row'] })).toEqual([
      'dispatcher::precedence::global>row',
    ])
    expect(findShortcutConflicts({ ...FIXTURE_MODEL, globalKeys: ['j', 'g', 'j'] })).toEqual([
      'global::duplicate::j',
    ])
  })

  it('flags a handler registered outside the known sites and a plain-character useHotkeys', () => {
    const violations = findShortcutRegistrationViolations({
      'features/shortcuts/use-registry-row-shortcuts.ts': "useShortcutHandler('row', handler)",
      'pages/orders/OrderPage.tsx': `
        // useShortcutHandler('row', commented) is not a registration
        useShortcutHandler('global', () => false)
        useHotkeys('n', openCreate)
        useHotkeys('mod+z', undo)
      `,
    })

    expect(violations).toEqual([
      'pages/orders/OrderPage.tsx::useHotkeys::n',
      'pages/orders/OrderPage.tsx::useShortcutHandler(global)::unregistered-site',
    ])
  })

  it('cannot assign shortcut keys to child actions until the parity model traverses children', () => {
    const entityActionSource = productionSources['features/actions/entity-action.ts'] ?? ''
    const childType = /export type EntityActionChild<[\s\S]*?\n\}/.exec(entityActionSource)?.[0] ?? ''

    expect(childType).toContain('EntityActionChild')
    expect(childType).not.toContain('shortcutKey')
  })

  it('keeps the dispatcher key sets inside the reserved list and ranks row above global', () => {
    expect(SHORTCUT_SCOPE_PRECEDENCE).toEqual(['row', 'global'])
    for (const key of [...DATA_TABLE_ROW_KEYS, ...GLOBAL_PLAIN_KEYS]) {
      expect(RESERVED_SINGLE_KEYS).toContain(key)
    }
  })

  it('matches the shortcut baseline on the real registry (remove fixed entries from registry-parity.shortcuts.baseline.json)', () => {
    const current = [
      ...findShortcutConflicts(realShortcutModel()),
      ...findShortcutRegistrationViolations(productionSources),
    ].sort()
    if (UPDATE_BASELINES) {
      writeGuardBaseline('actions', 'registry-parity.shortcuts.baseline.json', 'shortcut-parity', current)
      return
    }

    const { added, stale } = diffBaseline(current, shortcutBaseline.violations)

    expect(added, 'New shortcut conflicts: pick a unique, non-reserved key in this scope.').toEqual([])
    expect(stale, 'Stale shortcut baseline entries: remove them from registry-parity.shortcuts.baseline.json.').toEqual([])
  })
})
