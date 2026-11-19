// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { statusClassMap } from '@/components/status/status-class-map'
import deEnums from '../../../../../../locales/de/enums.json'
import enEnums from '../../../../../../locales/en/enums.json'
import { UPDATE_BASELINES, writeGuardBaseline } from './baseline-files'
import { diffBaseline } from './baseline-ratchet'
import { productionSources } from './production-sources'
import baseline from './status-badge.baseline.json'
import { evaluateStatusBadgeGuard, findMissingStatusLabels } from './status-badge'

const violationsFor = (sources: Record<string, string>) => evaluateStatusBadgeGuard(sources).violations

describe('status badge guard', () => {
  it('fails naming file and rule when a new file adds tinted-tone status styling', () => {
    const violations = violationsFor({
      'pages/orders/NewOrderBadge.tsx': `
        export function NewOrderBadge() {
          return <span className="bg-success/10 text-success">Paid</span>
        }
      `,
    })

    expect(violations).toEqual(['pages/orders/NewOrderBadge.tsx::tinted-tone'])
    expect(diffBaseline(violations, []).added).toEqual(['pages/orders/NewOrderBadge.tsx::tinted-tone'])
  })

  it('fails with local-status-map when a file defines a status-to-class map outside status-class-map.ts', () => {
    const violations = violationsFor({
      'pages/invoices/InvoiceRow.tsx': `
        const STATUS_CLASSES = {
          PAID: 'bg-muted text-foreground',
          DRAFT: 'border-border text-muted-foreground',
        }
        export function InvoiceRow({ status }: { status: keyof typeof STATUS_CLASSES }) {
          return <span className={STATUS_CLASSES[status]}>{status}</span>
        }
      `,
    })

    expect(violations).toEqual(['pages/invoices/InvoiceRow.tsx::local-status-map'])
  })

  it('fails as stale when a baselined file is migrated to StatusBadge but still listed', () => {
    const current = violationsFor({
      'pages/orders/MigratedOrderBadge.tsx': `
        import { StatusBadge } from '@/components/status/StatusBadge'
        export function MigratedOrderBadge({ status }: { status: string }) {
          return <StatusBadge status={status} />
        }
      `,
    })

    const { added, stale } = diffBaseline(current, ['pages/orders/MigratedOrderBadge.tsx::tinted-tone'])

    expect(added).toEqual([])
    expect(stale).toEqual(['pages/orders/MigratedOrderBadge.tsx::tinted-tone'])
  })

  it('reports no violation when StatusBadge is used and ignores excluded directories', () => {
    const violations = violationsFor({
      'pages/orders/OrderBadge.tsx': `
        import { StatusBadge } from '@/components/status/StatusBadge'
        export function OrderBadge({ status }: { status: string }) {
          return <StatusBadge status={status} />
        }
      `,
      'components/status/StatusBadge.tsx': `
        export const Pill = () => <span className="bg-success/10 text-success" />
      `,
      'components/ui/badge.tsx': `
        export const Badge = () => <span className="bg-destructive/10 text-destructive" />
      `,
      'components/inventory/GuardedPriceStateBadge.tsx': `
        import { StatusBadge } from '@/components/status/StatusBadge'
        const STATUS_BADGE_MAP = { APPLIED: 'APPLIED', CONFLICT: 'CONFLICT' }
        const STATE_LABEL_KEY = { APPLIED: 'bulk.adjustPrice.states.applied', CONFLICT: 'bulk.adjustPrice.states.conflict' }
        export function GuardedPriceStateBadge({ status }: { status: keyof typeof STATUS_BADGE_MAP }) {
          return <StatusBadge status={STATUS_BADGE_MAP[status]} label={STATE_LABEL_KEY[status]} />
        }
      `,
    })

    expect(violations).toEqual([])
  })

  it('fails the label check when a statusClassMap key lacks a de or en label', () => {
    const missing = findMissingStatusLabels(
      ['PAID', 'DRAFT', 'NEW_UNTRANSLATED_STATUS'],
      { PAID: 'Bezahlt', DRAFT: '' },
      { PAID: 'Paid' },
    )

    expect(missing).toEqual([
      { key: 'DRAFT', missingIn: ['de', 'en'] },
      { key: 'NEW_UNTRANSLATED_STATUS', missingIn: ['de', 'en'] },
    ])
  })

  it('ignores eslint-disable comments so suppressed violations still fail', () => {
    const directive = ['eslint', 'disable'].join('-')
    const violations = violationsFor({
      'pages/Suppressed.tsx': [
        'export function Suppressed() {',
        '  return (',
        '    <>',
        `      {/* ${directive}-next-line */}`,
        '      {/* bg-warning/10 in a comment is not code */}',
        `      {/* ${directive} */}`,
        '      <span className="bg-success/10 text-success">OK</span>',
        '    </>',
        '  )',
        '}',
      ].join('\n'),
    })

    expect(violations).toEqual(['pages/Suppressed.tsx::tinted-tone'])
  })

  describe('current main', () => {
    const { violations } = evaluateStatusBadgeGuard(productionSources)

    it('matches the baseline: no new ad hoc status styling, no stale entry', () => {
      if (UPDATE_BASELINES) {
        writeGuardBaseline('guards', 'status-badge.baseline.json', 'status-badge', violations)
        return
      }

      const { added, stale } = diffBaseline(violations, baseline.violations)

      expect(
        added,
        'Use StatusBadge (@/components/status/StatusBadge) and statusClassMap (status-class-map.ts) instead of ad hoc status styling.',
      ).toEqual([])
      expect(stale, 'Migrated: remove these lines from status-badge.baseline.json.').toEqual([])
    })

    it('has a non-empty de and en label for every statusClassMap key', () => {
      const missing = findMissingStatusLabels(
        Object.keys(statusClassMap),
        deEnums.status,
        enEnums.status,
      )

      expect(
        missing,
        'Every statusClassMap key must have a non-empty translation in locales/de/enums.json and locales/en/enums.json under "status".',
      ).toEqual([])
    })
  })
})
