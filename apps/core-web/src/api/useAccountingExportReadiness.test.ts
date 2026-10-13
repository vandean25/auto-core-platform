import { describe, expect, it } from 'vitest'

import { buildAccountingExportReadinessQuery } from './useAccountingExportReadiness'

describe('buildAccountingExportReadinessQuery', () => {
  it('serializes the legal entity and period, and omits filters that are not set', () => {
    expect(
      buildAccountingExportReadinessQuery({
        legalEntityId: 'le-1',
        dateFrom: '2026-03-01',
        dateTo: '2026-03-31',
      }),
    ).toBe('legalEntityId=le-1&dateFrom=2026-03-01&dateTo=2026-03-31')
  })

  it('adds reason, document type, search and paging when they are set', () => {
    const params = new URLSearchParams(
      buildAccountingExportReadinessQuery({
        legalEntityId: 'le-1',
        dateFrom: '2026-03-01',
        dateTo: '2026-03-31',
        reason: 'UNSUPPORTED_EXPORT_COUNTRY',
        documentKind: 'CREDIT_NOTE',
        search: 'RE 2026',
        page: 2,
        limit: 25,
      }),
    )

    expect(params.get('reason')).toBe('UNSUPPORTED_EXPORT_COUNTRY')
    expect(params.get('documentKind')).toBe('CREDIT_NOTE')
    expect(params.get('search')).toBe('RE 2026')
    expect(params.get('page')).toBe('2')
    expect(params.get('limit')).toBe('25')
  })

  it('sends the sorted column and direction when the table is sorted', () => {
    const params = new URLSearchParams(
      buildAccountingExportReadinessQuery({
        legalEntityId: 'le-1',
        dateFrom: '2026-03-01',
        dateTo: '2026-03-31',
        sortField: 'site',
        sortDirection: 'desc',
      }),
    )

    expect(params.get('sortField')).toBe('site')
    expect(params.get('sortDirection')).toBe('desc')
  })
})
