import { describe, expect, it } from 'vitest'
import {
  describeApproval,
  estimateBadgeLabel,
  isRecordableNote,
  isSameGrossAmount,
  messageForErrorCode,
  normalizeGrossAmount,
  OVERRUN_NOTICE_ERROR_MESSAGES,
  RECORD_DECISION_ERROR_MESSAGES,
} from './workshop-estimate-decision'

const approval = (overrides: Partial<Parameters<typeof describeApproval>[0]>) => ({
  id: 'a1',
  channel: 'PHONE' as const,
  decision: 'APPROVED' as const,
  decided_at: '2026-10-12T08:00:00.000Z',
  amount_quoted_gross: '192.00',
  customer_reaction: null,
  note: null,
  recorded_by_user_id: 'user-1',
  ...overrides,
})

describe('normalizeGrossAmount', () => {
  it('accepts a dot or comma decimal with exactly two places', () => {
    expect(normalizeGrossAmount('192.00')).toBe('192.00')
    expect(normalizeGrossAmount(' 192,00 ')).toBe('192.00')
  })

  it('rejects amounts without cents or with more places', () => {
    expect(normalizeGrossAmount('192')).toBeNull()
    expect(normalizeGrossAmount('192.5')).toBeNull()
    expect(normalizeGrossAmount('1.920,00')).toBeNull()
    expect(normalizeGrossAmount('abc')).toBeNull()
  })
})

describe('isSameGrossAmount', () => {
  it('compares to the cent and treats a missing total as different', () => {
    expect(isSameGrossAmount('192.00', '192.00')).toBe(true)
    expect(isSameGrossAmount('192.00', '192.01')).toBe(false)
    expect(isSameGrossAmount('192.00', null)).toBe(false)
  })
})

describe('isRecordableNote', () => {
  it('needs three to five hundred characters after trimming', () => {
    expect(isRecordableNote('  ok ')).toBe(false)
    expect(isRecordableNote('abc')).toBe(true)
    expect(isRecordableNote('x'.repeat(501))).toBe(false)
  })
})

describe('describeApproval', () => {
  it('says a customer link decision is electronically confirmed, never digitally signed', () => {
    const text = describeApproval(approval({ channel: 'LINK' }))
    expect(text).toBe('Elektronisch bestätigt über den Kundenlink')
    expect(text).not.toMatch(/signiert/i)
  })

  it('names the advisor and the channel for an advisor-recorded decision', () => {
    expect(describeApproval(approval({ channel: 'PHONE' }))).toBe('Vom Berater erfasst: Freigabe per telefon')
    expect(describeApproval(approval({ channel: 'IN_PERSON', decision: 'DECLINED' }))).toBe(
      'Vom Berater erfasst: Ablehnung per persönlich',
    )
  })
})

describe('estimateBadgeLabel', () => {
  it('shows the customer side of a sent estimate and its final state', () => {
    expect(estimateBadgeLabel('SENT')).toBe('Kunde ausstehend')
    expect(estimateBadgeLabel('APPROVED')).toBe('Freigegeben')
    expect(estimateBadgeLabel('SUPERSEDED')).toBe('Ersetzt')
  })
})

describe('messageForErrorCode', () => {
  it('uses the safe German text for a known code and the fallback otherwise', () => {
    expect(messageForErrorCode(RECORD_DECISION_ERROR_MESSAGES, 'ESTIMATE_VERSION_SUPERSEDED', 'x')).toContain(
      'durch eine neuere ersetzt',
    )
    expect(messageForErrorCode(OVERRUN_NOTICE_ERROR_MESSAGES, 'UNKNOWN', 'Fallback')).toBe('Fallback')
    expect(messageForErrorCode(OVERRUN_NOTICE_ERROR_MESSAGES, undefined, 'Fallback')).toBe('Fallback')
  })
})
