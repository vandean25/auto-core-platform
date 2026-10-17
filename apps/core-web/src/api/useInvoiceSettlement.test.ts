// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { initI18n } from '@/lib/i18n'
import { getErrorCode, getErrorMessage } from '@/lib/error-utils'
import {
  SettlementMutationError,
  throwIfSettlementResponseNotOk,
} from './useInvoiceSettlement'

describe('throwIfSettlementResponseNotOk', () => {
  beforeAll(async () => {
    await initI18n({ language: 'de' })
  })

  it('does nothing when the response is ok', () => {
    const response = new Response('{}', { status: 200 })
    expect(() =>
      throwIfSettlementResponseNotOk(response, {}, 'settlement.errors.recordFailed'),
    ).not.toThrow()
  })

  it('throws an HTTP error with wire code preserved for getErrorMessage', () => {
    const response = new Response(
      JSON.stringify({
        code: 'FISCAL_PERIOD_LOCKED',
        message: 'Fiscal period is locked for the selected date.',
      }),
      { status: 422 },
    )
    const body = {
      code: 'FISCAL_PERIOD_LOCKED',
      message: 'Fiscal period is locked for the selected date.',
    }

    let thrown: unknown
    try {
      throwIfSettlementResponseNotOk(response, body, 'settlement.errors.reconcileFailed')
    } catch (error) {
      thrown = error
    }

    expect(getErrorCode(thrown)).toBe('FISCAL_PERIOD_LOCKED')
    expect(getErrorMessage(thrown, 'Reconciliation failed')).toBe('Fiskalperiode ist gesperrt.')
  })

  it('throws SettlementMutationError when the body has no wire code', () => {
    const response = new Response(
      JSON.stringify({ message: 'Something went wrong' }),
      { status: 500 },
    )

    let thrown: unknown
    try {
      throwIfSettlementResponseNotOk(
        response,
        { message: 'Something went wrong' },
        'settlement.errors.cancellationFailed',
      )
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(SettlementMutationError)
    expect((thrown as SettlementMutationError).i18nKey).toBe(
      'settlement.errors.cancellationFailed',
    )
  })
})
