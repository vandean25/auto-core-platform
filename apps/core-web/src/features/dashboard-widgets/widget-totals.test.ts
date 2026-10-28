import { describe, expect, it } from 'vitest'

import type { DashboardWidget } from './types'
import { isPartialResult, isTruncated, widgetCount } from './widget-totals'

const rows = (count: number) => Array.from({ length: count }, (_, index) => ({ id: index }))

describe('widgetCount', () => {
  it('shows the server total when the page is only part of an unfiltered result', () => {
    expect(widgetCount({ rows: rows(50), fetchedCount: 50, total: 75, hasClientFilters: false })).toEqual({ value: 75, isLowerBound: false })
  })

  it('counts the rows when the whole result was fetched', () => {
    expect(widgetCount({ rows: rows(20), fetchedCount: 20, total: 20, hasClientFilters: false })).toEqual({ value: 20, isLowerBound: false })
    expect(widgetCount({ rows: rows(3), fetchedCount: 20, total: 20, hasClientFilters: false })).toEqual({ value: 3, isLowerBound: false })
  })

  it('reports a lower bound when the widget has filters, even if every fetched row matches them', () => {
    expect(widgetCount({ rows: rows(50), fetchedCount: 50, total: 75, hasClientFilters: true })).toEqual({
      value: 50,
      isLowerBound: true,
    })
  })

  it('reports a lower bound when client-side filters narrow a truncated page', () => {
    expect(widgetCount({ rows: rows(10), fetchedCount: 50, total: 75, hasClientFilters: false })).toEqual({ value: 10, isLowerBound: true })
  })
})

describe('isTruncated', () => {
  it('is true only when the server has more matches than were fetched', () => {
    expect(isTruncated({ fetchedCount: 50, total: 75 })).toBe(true)
    expect(isTruncated({ fetchedCount: 50, total: 50 })).toBe(false)
  })
})

describe('isPartialResult', () => {
  const widget = (overrides: Partial<DashboardWidget>): DashboardWidget => ({
    id: 'w',
    name: 'W',
    sourceKey: 'vehicles',
    sourceLabel: 'Vehicles',
    href: '/vehicles',
    displayType: 'metric',
    createdAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  })
  const truncated = { rows: rows(50), fetchedCount: 50, total: 75, hasClientFilters: false }

  it('is never partial when the whole result was fetched', () => {
    const complete = { rows: rows(20), fetchedCount: 20, total: 20, hasClientFilters: false }
    expect(isPartialResult(widget({ displayType: 'donut', groupByField: 'make' }), complete)).toBe(false)
    expect(isPartialResult(widget({ metricCalculation: 'sum', metricField: 'year' }), complete)).toBe(false)
  })

  it('is partial for groups and sums over a truncated page, not for an unfiltered count or a list', () => {
    expect(isPartialResult(widget({ displayType: 'donut', groupByField: 'make' }), truncated)).toBe(true)
    expect(isPartialResult(widget({ metricCalculation: 'sum', metricField: 'year' }), truncated)).toBe(true)
    expect(isPartialResult(widget({}), truncated)).toBe(false)
    expect(isPartialResult(widget({ displayType: 'list' }), truncated)).toBe(false)
  })

  it('is partial for a count that client-side filters narrowed over a truncated page', () => {
    expect(isPartialResult(widget({}), { rows: rows(10), fetchedCount: 50, total: 75, hasClientFilters: false })).toBe(true)
  })
})
