import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RegistrationDocumentReview } from './RegistrationDocumentReview'
import { deWorkshop } from '@/test/de-workshop'

const baseIntake = {
  id: 'intake-1',
  state: 'APPLIED',
  evidence: {
    documentKind: 'AT_ZULASSUNGSSCHEIN',
    warnings: [],
    fields: {
      holder: {
        raw: null,
        normalized: { firstName: 'Max', lastName: 'Mustermann' },
        uncertainty: 0.1,
      },
    },
  },
  matchSnapshot: { cases: [], customers: [], vehicles: [] },
}

describe('RegistrationDocumentReview', () => {
  afterEach(() => {
    cleanup()
  })

  it('starts check-in when no workshop order exists yet', () => {
    const onStartCheckIn = vi.fn().mockResolvedValue(undefined)
    render(
      <RegistrationDocumentReview
        intake={baseIntake}
        onApply={vi.fn()}
        onStartCheckIn={onStartCheckIn}
        onContinueCheckIn={vi.fn()}
        onAbort={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', { name: deWorkshop.registrationReview.startCheckIn }),
    )

    expect(onStartCheckIn).toHaveBeenCalledTimes(1)
  })

  it('continues check-in without creating another order when one is linked', () => {
    const onStartCheckIn = vi.fn()
    const onContinueCheckIn = vi.fn()
    render(
      <RegistrationDocumentReview
        intake={{ ...baseIntake, appliedWorkshopOrderId: 'order-existing' }}
        onApply={vi.fn()}
        onStartCheckIn={onStartCheckIn}
        onContinueCheckIn={onContinueCheckIn}
        onAbort={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', { name: deWorkshop.registrationReview.continueCheckIn }),
    )

    expect(onContinueCheckIn).toHaveBeenCalledWith('order-existing')
    expect(onStartCheckIn).not.toHaveBeenCalled()
  })
})
