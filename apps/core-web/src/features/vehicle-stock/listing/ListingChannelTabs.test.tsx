import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { registerGermanUiForTests } from '@/test/german-ui'
import deVehicleStock from '../../../../../../locales/de/vehicleStock.json'
import { ListingChannelTabs } from './ListingChannelTabs'

registerGermanUiForTests()

afterEach(cleanup)

const channels = [
  { platform: 'MOBILE_DE', desired_state: 'ACTIVE' },
  { platform: 'WILLHABEN', desired_state: 'INACTIVE' },
] as never

function renderTabs(overrides: Partial<Parameters<typeof ListingChannelTabs>[0]> = {}) {
  const onToggleActive = vi.fn()
  render(
    <ListingChannelTabs
      channels={channels}
      validationChannels={[]}
      validationFailed={false}
      onToggleActive={onToggleActive}
      {...overrides}
    />,
  )
  return { onToggleActive }
}

describe('ListingChannelTabs', () => {
  it('shows one tab per channel and the offer toggle reflects desired_state', () => {
    renderTabs()

    expect(screen.getByRole('tab', { name: 'MOBILE.DE' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'WILLHABEN' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: deVehicleStock.listing.portals.desiredActive })).toBeChecked()
  })

  it('reports the toggled platform and the new state', () => {
    const { onToggleActive } = renderTabs()

    fireEvent.click(screen.getByRole('checkbox', { name: deVehicleStock.listing.portals.desiredActive }))

    expect(onToggleActive).toHaveBeenCalledWith('MOBILE_DE', false)
  })

  it('shows the validation messages for the selected channel', () => {
    renderTabs({
      validationChannels: [
        { platform: 'MOBILE_DE', serializer_supported: true, issues: [{ field: 'price_gross_eur', code: 'LISTING_PRICE_REQUIRED', message: 'x' }] },
      ] as never,
    })

    expect(screen.getByText(deVehicleStock.listing.validation.LISTING_PRICE_REQUIRED)).toBeInTheDocument()
  })

  // Regression guard: a failed validation request must not show stale "no issues" text as if the channel were clean.
  it('hides the issue list while validation has failed', () => {
    renderTabs({ validationFailed: true })

    expect(screen.queryByText(deVehicleStock.listing.portals.noIssues)).not.toBeInTheDocument()
  })
})
