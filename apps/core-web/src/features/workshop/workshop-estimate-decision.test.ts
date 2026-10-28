import { describe, expect, it, beforeAll } from 'vitest'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import {
  describeApproval,
  estimateBadgeLabel,
  estimateStatusTone,
  isRecordableNote,
  isSameGrossAmount,
  messageForErrorCode,
  normalizeGrossAmount,
  overrunNoticeErrorMessages,
  recordDecisionErrorMessages,
  reactionOptionsFor,
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

beforeAll(async () => {
  await ensureNamespaceLoaded('workshop')
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
    expect(describeApproval(approval({ channel: 'PHONE' }))).toBe('Vom Berater erfasst: Freigabe telefonisch')
    expect(describeApproval(approval({ channel: 'EMAIL' }))).toBe('Vom Berater erfasst: Freigabe per E-Mail')
    expect(describeApproval(approval({ channel: 'IN_PERSON', decision: 'DECLINED' }))).toBe(
      'Vom Berater erfasst: Ablehnung persönlich',
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

describe('estimateStatusTone', () => {
  it('lets only an expired estimate stand out', () => {
    expect(estimateStatusTone('EXPIRED')).toBe('ESTIMATE_EXPIRED')
    expect(estimateStatusTone('SENT')).toBe('SENT')
    expect(estimateStatusTone('DECLINED')).toBe('DECLINED')
  })
})

describe('reactionOptionsFor', () => {
  it('offers only the reactions that fit an approval', () => {
    expect(reactionOptionsFor('APPROVED').map((option) => option.value)).toEqual(['AGREED', 'QUESTIONED'])
  })

  it('offers only the reactions that fit a refusal', () => {
    expect(reactionOptionsFor('DECLINED').map((option) => option.value)).toEqual([
      'DECLINED',
      'QUESTIONED',
      'CALLBACK_REQUESTED',
    ])
  })
})

describe('messageForErrorCode', () => {
  it('maps the codes of an unsendable version and of a reaction that does not fit the decision', () => {
    expect(messageForErrorCode(recordDecisionErrorMessages(), 'ESTIMATE_REACTION_MISMATCH', 'x')).toContain(
      'Reaktion',
    )
    expect(messageForErrorCode(recordDecisionErrorMessages(), 'ESTIMATE_VERSION_NOT_DECIDABLE', 'x')).toContain(
      'nicht vollständig gesendet',
    )
  })

  it('uses the safe German text for a known code and the fallback otherwise', () => {
    expect(messageForErrorCode(recordDecisionErrorMessages(), 'ESTIMATE_VERSION_SUPERSEDED', 'x')).toContain(
      'durch eine neuere ersetzt',
    )
    expect(messageForErrorCode(overrunNoticeErrorMessages(), 'UNKNOWN', 'Fallback')).toBe('Fallback')
    expect(messageForErrorCode(overrunNoticeErrorMessages(), undefined, 'Fallback')).toBe('Fallback')
  })
})
