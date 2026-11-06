// @vitest-environment node
import { describe, expect, it } from 'vitest'

import baseline from './intent-prefetch.baseline.json'
import { UPDATE_BASELINES, writeGuardBaseline } from './baseline-files'
import { diffBaseline } from './baseline-ratchet'
import { evaluatePrefetchGuard } from './intent-prefetch'
import { productionSources } from './production-sources'
import exceptionsDocument from '../intent-prefetch-exceptions.json'

const WIRED_LIST = `
import { scheduleDetailPrefetch } from '@/lib/intent-prefetch'
import { DataTable } from '@/components/data-table/DataTable'

export function InvoiceList({ queryClient }: Props) {
  return (
    <DataTable
      columns={columns}
      rowBehaviour={{
        onRowClick: (row) => navigate('/invoices/' + row.id),
        onRowPrefetch: (row) => scheduleDetailPrefetch(queryClient, invoiceDetailQueryOptions(row.id)),
      }}
    />
  )
}
`

const UNWIRED_LIST = `
import { DataTable } from '@/components/data-table/DataTable'

export function OrderList() {
  return (
    <DataTable columns={columns} rowBehaviour={{ onRowClick: (row) => navigate('/orders/' + row.id) }} />
  )
}
`

const evaluate = (
  sources: Record<string, string>,
  exceptions: Array<{ file: string; reason: string }> = [],
  wrappers?: string[],
) => evaluatePrefetchGuard({ sources, exceptions, wrappers })

describe('intent prefetch guard (ADR-0036 R4)', () => {
  it('passes a navigable list that routes onRowPrefetch through the shared scheduler', () => {
    expect(evaluate({ 'pages/sales/InvoiceList.tsx': WIRED_LIST }).violations).toEqual([])
  })

  it.each([
    {
      name: 'a navigable list without onRowPrefetch',
      source: UNWIRED_LIST,
      expected: ['pages/orders/OrderList.tsx::DataTable::missing-intent-prefetch'],
    },
    {
      name: 'a list whose onRowPrefetch bypasses the shared scheduler',
      source: UNWIRED_LIST.replace(
        'onRowClick:',
        'onRowPrefetch: (row) => queryClient.prefetchQuery(orderQuery(row.id)), onRowClick:',
      ),
      expected: ['pages/orders/OrderList.tsx::DataTable::prefetch-bypasses-scheduler'],
    },
    {
      name: 'row behaviour built by a hook that never prefetches',
      source: UNWIRED_LIST.replace(
        'rowBehaviour={{ onRowClick: (row) => navigate(\'/orders/\' + row.id) }}',
        'rowBehaviour={useOrderListRowBehaviour()}',
      ),
      hook: "export function useOrderListRowBehaviour() { return { onRowClick: (row) => navigate('/orders/' + row.id) } }",
      expected: ['pages/orders/OrderList.tsx::DataTable::missing-intent-prefetch'],
    },
  ])('flags $name', ({ source, hook, expected }) => {
    const sources: Record<string, string> = { 'pages/orders/OrderList.tsx': source }
    if (hook) sources['pages/orders/useOrderListRowBehaviour.ts'] = hook

    expect(evaluate(sources).violations).toEqual(expected)
  })

  it('finds the scheduler wiring inside a row-behaviour hook', () => {
    const sources = {
      'pages/orders/OrderList.tsx': UNWIRED_LIST.replace(
        'rowBehaviour={{ onRowClick: (row) => navigate(\'/orders/\' + row.id) }}',
        'rowBehaviour={useOrderListRowBehaviour()}',
      ),
      'pages/orders/useOrderListRowBehaviour.ts': `
        import { scheduleDetailPrefetch } from '@/lib/intent-prefetch'
        export function useOrderListRowBehaviour() {
          return {
            onRowClick: (row) => navigate('/orders/' + row.id),
            onRowPrefetch: (row) => scheduleDetailPrefetch(client, orderQueryOptions(row.id)),
          }
        }
      `,
    }

    expect(evaluate(sources).violations).toEqual([])
  })

  it('ignores a list without a detail target and a wiring that only exists in a comment', () => {
    const sources = {
      'pages/logs/LogList.tsx': '<DataTable columns={columns} rowBehaviour={{ getRowAccessibleName }} />',
      'pages/orders/OrderList.tsx': `// onRowPrefetch: scheduleDetailPrefetch(client, options)\n${UNWIRED_LIST}`,
    }

    expect(evaluate(sources).violations).toEqual(['pages/orders/OrderList.tsx::DataTable::missing-intent-prefetch'])
  })

  it('accepts a reasoned exception and flags it stale once the list is wired or gone', () => {
    const exception = { file: 'pages/orders/OrderList.tsx', reason: 'Row click opens a dialog from the loaded row.' }

    expect(evaluate({ 'pages/orders/OrderList.tsx': UNWIRED_LIST }, [exception])).toEqual({
      violations: [],
      staleExceptions: [],
    })
    expect(evaluate({ 'pages/orders/OrderList.tsx': WIRED_LIST }, [exception]).staleExceptions).toEqual([
      'pages/orders/OrderList.tsx',
    ])
    expect(evaluate({}, [exception]).staleExceptions).toEqual(['pages/orders/OrderList.tsx'])
  })

  it('requires a component that forwards rowBehaviour from props to be registered, then scans its consumers', () => {
    const wrapper = `
      export function RecordTable({ rowBehaviour, columns }: Props) {
        return <DataTable columns={columns} rowBehaviour={rowBehaviour} />
      }
    `
    const consumer = `
      export function PartsPage() {
        return <RecordTable columns={columns} rowBehaviour={{ onRowClick: (row) => navigate('/parts/' + row.id) }} />
      }
    `

    expect(evaluate({ 'components/RecordTable.tsx': wrapper }).violations).toEqual([
      'components/RecordTable.tsx::DataTable::unregistered-wrapper',
    ])
    expect(
      evaluate({ 'components/RecordTable.tsx': wrapper, 'pages/PartsPage.tsx': consumer }, [], ['RecordTable']).violations,
    ).toEqual(['pages/PartsPage.tsx::DataTable::missing-intent-prefetch'])
  })

  describe('current main', () => {
    const result = evaluatePrefetchGuard({
      sources: productionSources,
      exceptions: exceptionsDocument.exceptions,
    })

    it('matches the baseline: no new unwired navigable list, no stale entry', () => {
      if (UPDATE_BASELINES) {
        writeGuardBaseline('guards', 'intent-prefetch.baseline.json', 'intent-prefetch', result.violations)
        return
      }

      const { added, stale } = diffBaseline(result.violations, baseline.violations)

      expect(
        added,
        'Wire rowBehaviour.onRowPrefetch through scheduleDetailPrefetch, or add a reasoned entry to intent-prefetch-exceptions.json.',
      ).toEqual([])
      expect(stale, 'Wired lists: remove their lines from intent-prefetch.baseline.json.').toEqual([])
    })

    it('keeps every exception reasoned and current', () => {
      expect(result.staleExceptions).toEqual([])
      for (const entry of exceptionsDocument.exceptions) {
        expect(entry.reason.trim().length, entry.file).toBeGreaterThan(20)
      }
    })

    it('wires the lists AUT-875 migrated', () => {
      const wired = ['pages/sales/InvoiceListPage.tsx', 'pages/InventoryList.tsx', 'pages/vehicle-stock/VehicleStockList.tsx']

      for (const file of wired) {
        expect(result.violations.filter((id) => id.startsWith(file)), file).toEqual([])
      }
    })
  })
})
