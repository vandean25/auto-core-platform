import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { I18nextProvider } from 'react-i18next'
import { i18n } from '@/lib/i18n'
import {
  CheckInSignaturePad,
  type CheckInSignaturePadHandle,
} from './CheckInSignaturePad'

function renderPad() {
  const padRef = createRef<CheckInSignaturePadHandle | null>()
  const onName = vi.fn()
  const onAck = vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <CheckInSignaturePad
        readOnly={false}
        signedByName=""
        onSignedByNameChange={onName}
        acknowledged={false}
        onAcknowledgedChange={onAck}
        padRef={padRef}
      />
    </I18nextProvider>,
  )
  return { padRef, onName, onAck }
}

describe('CheckInSignaturePad', () => {
  it('renders legal placeholder and signer name field', () => {
    renderPad()
    expect(screen.getByTestId('check-in-signature-legal-placeholder')).toBeInTheDocument()
    expect(screen.getByTestId('check-in-signed-by-name')).toBeInTheDocument()
    expect(screen.getByTestId('check-in-signature-clear')).toHaveClass('min-h-11')
  })

  it('updates signer name on input', () => {
    const { onName } = renderPad()
    fireEvent.change(screen.getByTestId('check-in-signed-by-name'), {
      target: { value: 'A' },
    })
    expect(onName).toHaveBeenCalled()
  })
})
