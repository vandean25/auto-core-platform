import { afterEach, describe, expect, it } from 'vitest'
import { clearLocalSiteSwitch, consumeLocalSiteSwitch, markLocalSiteSwitch } from './local-site-switch'

describe('local site switch marker', () => {
  afterEach(clearLocalSiteSwitch)

  it('answers the matching event once', () => {
    markLocalSiteSwitch('site-1', 1_000)

    expect(consumeLocalSiteSwitch('site-1', 2_000)).toBe(true)
    expect(consumeLocalSiteSwitch('site-1', 2_001)).toBe(false)
  })

  it('does not answer an event for another site, a cleared site or after it expired', () => {
    markLocalSiteSwitch('site-1', 1_000)
    expect(consumeLocalSiteSwitch('site-2', 1_100)).toBe(false)
    expect(consumeLocalSiteSwitch(null, 1_100)).toBe(false)
    expect(consumeLocalSiteSwitch('site-1', 1_000 + 15_001)).toBe(false)
  })

  it('knows a switch to no site and forgets a failed switch', () => {
    markLocalSiteSwitch(null, 1_000)
    expect(consumeLocalSiteSwitch(null, 1_100)).toBe(true)

    markLocalSiteSwitch('site-1', 1_000)
    clearLocalSiteSwitch()
    expect(consumeLocalSiteSwitch('site-1', 1_100)).toBe(false)
  })

  it('does nothing without a switch of this tab', () => {
    expect(consumeLocalSiteSwitch('site-1')).toBe(false)
  })
})
