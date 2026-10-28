import { describe, expect, it } from 'vitest'

import {
  hasInvalidSentRange,
  parseEstimateListView,
  toEstimateApiFilters,
  writeEstimateListView,
  type EstimateListView,
} from './workshop-estimate-list-filters'

const emptyView = parseEstimateListView(new URLSearchParams())

describe('estimate list filters', () => {
  it('opens on SENT without anything in the URL', () => {
    expect(emptyView.status).toBe('SENT')
    expect(toEstimateApiFilters(emptyView)).toEqual({ status: 'SENT' })
    expect(writeEstimateListView(new URLSearchParams(), emptyView).toString()).toBe('')
  })

  it('sends no status for All, so the API hides the older versions', () => {
    expect(toEstimateApiFilters({ ...emptyView, status: 'ALL' })).toEqual({})
  })

  it('asks for SUPERSEDED explicitly when older versions are shown', () => {
    expect(toEstimateApiFilters({ ...emptyView, status: 'APPROVED', showOlder: true })).toEqual({ status: 'SUPERSEDED' })
  })

  it('round-trips the view through the URL and keeps other params', () => {
    const view: EstimateListView = {
      status: 'DECLINED',
      showOlder: false,
      customerId: 'c-1',
      customerName: 'Muster GmbH',
      sentFrom: '2026-10-01',
      sentTo: '2026-10-31',
    }
    const written = writeEstimateListView(new URLSearchParams('search=abc'), view)
    expect(written.get('search')).toBe('abc')
    expect(parseEstimateListView(written)).toEqual(view)
    expect(toEstimateApiFilters(view)).toEqual({
      status: 'DECLINED',
      customerId: 'c-1',
      sentFrom: '2026-10-01',
      sentTo: '2026-10-31',
    })
  })

  it('falls back to SENT for an unknown status in the URL', () => {
    expect(parseEstimateListView(new URLSearchParams('status=BOGUS')).status).toBe('SENT')
  })

  it('ignores malformed days and a customer id without a name in the URL', () => {
    const view = parseEstimateListView(new URLSearchParams('sentFrom=garbage&sentTo=2026-10-31&customerId=c-1'))
    expect(view.sentFrom).toBe('')
    expect(view.sentTo).toBe('2026-10-31')
    expect(view.customerId).toBe('')
  })

  it('sends the sent range only as a valid pair', () => {
    expect(toEstimateApiFilters({ ...emptyView, sentFrom: '2026-10-01' })).toEqual({ status: 'SENT' })
    expect(hasInvalidSentRange({ sentFrom: '2026-10-01', sentTo: '' })).toBe(true)
    expect(hasInvalidSentRange({ sentFrom: '2026-10-05', sentTo: '2026-10-01' })).toBe(true)
    expect(hasInvalidSentRange({ sentFrom: '', sentTo: '' })).toBe(false)
  })
})
