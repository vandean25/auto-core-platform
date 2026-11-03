import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { EffectiveCapabilities } from '@/api/auth-session'
import { registerGermanUiForTests } from '@/test/german-ui'
import deVehicleStock from '../../../../../../locales/de/vehicleStock.json'
import { ListingPriceConfirmations } from './ListingPriceConfirmations'

const mocks = vi.hoisted(() => ({ capabilities: null as EffectiveCapabilities | null }))

vi.mock('@/api/auth-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/auth-session')>()),
  useAuthSession: () => ({ data: { effectiveCapabilities: mocks.capabilities } }),
}))

registerGermanUiForTests()

afterEach(() => {
  cleanup()
  mocks.capabilities = null
})

const values = { nova_included_confirmed: false, mandatory_fees_included_confirmed: true }
const novaLabel = deVehicleStock.listing.fields.novaIncluded
const feesLabel = deVehicleStock.listing.fields.mandatoryFeesIncluded

describe('ListingPriceConfirmations', () => {
  // Positive control: the NoVA box renders when the capability is on, so the absent case proves the gate.
  it.each([true, false])('shows the NoVA confirmation only when nova is %s', (nova) => {
    mocks.capabilities = { nova, pickerl57a: true, kaufvertragAt: true, willhabenExport: true }

    render(<ListingPriceConfirmations values={values} issues={[]} onChange={vi.fn()} />)

    expect(screen.getByText(feesLabel)).toBeInTheDocument()
    if (nova) {
      expect(screen.getByText(novaLabel)).toBeInTheDocument()
    } else {
      expect(screen.queryByText(novaLabel)).not.toBeInTheDocument()
    }
  })

  it('reports the changed confirmation as a patch', () => {
    mocks.capabilities = { nova: true, pickerl57a: true, kaufvertragAt: true, willhabenExport: true }
    const onChange = vi.fn()
    render(<ListingPriceConfirmations values={values} issues={[]} onChange={onChange} />)

    fireEvent.click(screen.getByRole('checkbox', { name: novaLabel }))

    expect(onChange).toHaveBeenCalledWith({ nova_included_confirmed: true })
  })
})
