import { renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { usePushDeepLink, type PushTenantSwitchResult } from './use-push-deep-link'

function setup(
  entry: string,
  overrides: Partial<Parameters<typeof usePushDeepLink>[0]> = {},
) {
  const options = {
    enabled: true,
    activeTenantId: 't1',
    activeSiteId: 's-b',
    siteIds: ['s-a', 's-b'],
    requestTenantSwitch: vi.fn(async (): Promise<PushTenantSwitchResult> => 'switched'),
    switchSite: vi.fn(async () => undefined),
    onRefused: vi.fn(),
    ...overrides,
  }
  const hook = renderHook(
    () => ({ link: usePushDeepLink(options), location: useLocation() }),
    { wrapper: ({ children }) => <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter> },
  )
  return { options, hook }
}

describe('usePushDeepLink', () => {
  it('does nothing for an ordinary address', () => {
    const { options, hook } = setup('/workshop/orders/o1')
    expect(hook.result.current.link.resolving).toBe(false)
    expect(options.switchSite).not.toHaveBeenCalled()
    expect(options.requestTenantSwitch).not.toHaveBeenCalled()
  })

  it('opens an order of another site of the user: switches the site through the authorized flow, then removes the hints', async () => {
    const { options, hook } = setup('/workshop/orders/o1?pushTenant=t1&pushSite=s-a')
    expect(hook.result.current.link.resolving).toBe(true)

    await waitFor(() => expect(options.switchSite).toHaveBeenCalledWith('s-a'))
    expect(options.requestTenantSwitch).not.toHaveBeenCalled()

    // The session now reports the new site.
    options.activeSiteId = 's-a'
    hook.rerender()
    await waitFor(() => expect(hook.result.current.link.resolving).toBe(false))
    expect(hook.result.current.location.pathname).toBe('/workshop/orders/o1')
    expect(hook.result.current.location.search).toBe('')
  })

  it('switches the tenant before the site', async () => {
    const { options, hook } = setup('/workshop/orders/o1?pushTenant=t2&pushSite=s-a')

    await waitFor(() => expect(options.requestTenantSwitch).toHaveBeenCalledWith('t2'))
    expect(options.switchSite).not.toHaveBeenCalled()
    expect(hook.result.current.link.resolving).toBe(true)
  })

  it('does not request the same switch twice while it is still running', async () => {
    const { options, hook } = setup('/workshop/orders/o1?pushTenant=t1&pushSite=s-a')
    await waitFor(() => expect(options.switchSite).toHaveBeenCalledTimes(1))
    hook.rerender()
    hook.rerender()
    expect(options.switchSite).toHaveBeenCalledTimes(1)
  })

  it('ends on the start page and tells the user when the site is not one of theirs', async () => {
    const { options, hook } = setup('/workshop/orders/o1?pushTenant=t1&pushSite=s-evil')

    await waitFor(() => expect(options.onRefused).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(hook.result.current.location.pathname).toBe('/'))
    expect(options.switchSite).not.toHaveBeenCalled()
  })

  it('ends on the start page when the server refuses the switch', async () => {
    const { hook } = setup('/workshop/orders/o1?pushTenant=t1&pushSite=s-a', {
      switchSite: vi.fn(async () => {
        throw new Error('forbidden')
      }),
    })

    await waitFor(() => expect(hook.result.current.location.pathname).toBe('/'))
    expect(hook.result.current.location.search).toBe('')
  })

  it('ends on the start page when the tenant switch fails', async () => {
    const { hook } = setup('/workshop/orders/o1?pushTenant=t2', {
      requestTenantSwitch: vi.fn(async (): Promise<PushTenantSwitchResult> => 'failed'),
    })

    await waitFor(() => expect(hook.result.current.location.pathname).toBe('/'))
  })

  it('does nothing before the session is loaded, but already holds the page back', () => {
    const { options, hook } = setup('/workshop/orders/o1?pushTenant=t2&pushSite=s-a', { enabled: false })
    expect(hook.result.current.link.resolving).toBe(true)
    expect(options.requestTenantSwitch).not.toHaveBeenCalled()
    expect(options.switchSite).not.toHaveBeenCalled()
  })

  it('abandon leaves an ordinary address alone', () => {
    const { hook } = setup('/customers?tab=notes')
    hook.result.current.link.abandon()
    expect(hook.result.current.location.pathname).toBe('/customers')
  })

  it('waits for the sites to load before it decides', async () => {
    const { options, hook } = setup('/workshop/orders/o1?pushTenant=t1&pushSite=s-a', { siteIds: null })
    expect(hook.result.current.link.resolving).toBe(true)
    expect(options.switchSite).not.toHaveBeenCalled()
    expect(options.onRefused).not.toHaveBeenCalled()
  })
})
