import { describe, expect, it } from 'vitest'

import type { EffectiveCapabilities } from '@/api/auth-session'
import { visibleListingChannels } from './listing-channel-visibility'

const channels = [{ platform: 'MOBILE_DE' }, { platform: 'WILLHABEN' }, { platform: 'AS24' }]
const withWillhaben: EffectiveCapabilities = { nova: true, pickerl57a: true, kaufvertragAt: true, willhabenExport: true }

describe('visibleListingChannels (AUT-686)', () => {
  it('keeps the willhaben channel when willhabenExport is on', () => {
    expect(visibleListingChannels(channels, withWillhaben).map((c) => c.platform)).toEqual(['MOBILE_DE', 'WILLHABEN', 'AS24'])
  })

  // Regression guard: other marketplaces must stay visible when only willhaben is switched off.
  it.each([
    ['willhabenExport is off', { ...withWillhaben, willhabenExport: false }],
    ['capabilities are null', null],
  ])('hides only the willhaben channel when %s', (_case, capabilities) => {
    expect(visibleListingChannels(channels, capabilities).map((c) => c.platform)).toEqual(['MOBILE_DE', 'AS24'])
  })
})
