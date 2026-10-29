import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchJsonWithAuth: vi.fn(),
  summarize: vi.fn(),
  hasUnsynced: vi.fn(),
  purge: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/api/api-error', () => ({ fetchJsonWithAuth: mocks.fetchJsonWithAuth }))
vi.mock('@/features/push/push-device', () => ({
  keepPushRegistrationAlive: vi.fn(),
  switchTenantWithPush: async (run: () => Promise<unknown>) => run(),
}))
vi.mock('@/features/workshop/check-in/check-in-offline-store', () => ({ purgeAllCheckInOfflineData: mocks.purge }))
vi.mock('@/features/workshop/check-in/check-in-offline-unsynced', () => ({
  summarizeCheckInOfflineUnsynced: mocks.summarize,
  hasUnsyncedCheckInOfflineData: mocks.hasUnsynced,
}))
vi.mock('@/features/workshop/check-in/CheckInOfflinePurgeDialog', () => ({
  CheckInOfflinePurgeDialog: (props: { onConfirm: () => void }) => (
    <button type='button' aria-label={'confirm'} data-testid='confirm' onClick={props.onConfirm} />
  ),
}))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: vi.fn() } }))

import { useMySites } from '@/api/sites'
import { ShellPurgePrompt, type CheckInOfflinePurgePrompt } from './ShellPurgePrompt'
import { PushLinkGate, useShellPush, useTenantSwitch } from './use-shell-push'

const LINK = '/workshop/orders/o1?pushTenant=t2&pushSite=s2'

/** The wiring of the signed-in shell that matters for a push link, with the real hooks and a fake session. */
function Shell(props: {
  switchTenant: (tenantId: string) => Promise<unknown>
  switchSite: (siteId: string) => Promise<unknown>
  onSession?: (setSession: (tenantId: string, siteId: string) => void) => void
}) {
  const location = useLocation()
  const [session, setSession] = React.useState({ tenantId: 't1', siteId: 's1' })
  const [prompt, setPrompt] = React.useState<CheckInOfflinePurgePrompt | null>(null)
  props.onSession?.((tenantId, siteId) => setSession({ tenantId, siteId }))
  const sites = useMySites(true, session.tenantId)
  const { completeTenantSwitch, requestTenantSwitch } = useTenantSwitch(props.switchTenant, setPrompt)
  const link = useShellPush({
    session: { activeTenant: { id: session.tenantId }, activeSiteId: session.siteId } as never,
    sites: sites.data,
    sitesLoading: sites.isFetching,
    requestTenantSwitch,
    switchSite: props.switchSite,
  })
  return (
    <>
      <span data-testid='path'>{location.pathname + location.search}</span>
      <span data-testid='resolving'>{String(link.resolving)}</span>
      <PushLinkGate resolving={link.resolving}>
        <span data-testid='page' />
      </PushLinkGate>
      {prompt && (
        <ShellPurgePrompt
          prompt={prompt}
          onClose={() => setPrompt(null)}
          onCancel={link.abandon}
          onSwitchFailed={link.abandon}
          completeTenantSwitch={completeTenantSwitch}
          signOutUser={async () => undefined}
        />
      )}
    </>
  )
}

function renderShell(shellProps: Parameters<typeof Shell>[0]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[LINK]}>
        <Shell {...shellProps} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('a push link across tenants', () => {
  beforeEach(() => {
    mocks.fetchJsonWithAuth.mockReset()
    mocks.summarize.mockReset().mockResolvedValue({ unsynced: 0 })
    mocks.hasUnsynced.mockReset().mockReturnValue(false)
    mocks.purge.mockReset().mockResolvedValue(undefined)
    mocks.toastError.mockReset()
  })

  it('does not judge the sites of the old tenant: it waits for the list of the new tenant, then switches the site', async () => {
    let t2Sites: (sites: unknown) => void = () => undefined
    mocks.fetchJsonWithAuth.mockImplementation(() => {
      const tenantCalls = mocks.fetchJsonWithAuth.mock.calls.length
      return tenantCalls === 1
        ? Promise.resolve([{ id: 's1' }])
        : new Promise((resolve) => {
            t2Sites = resolve
          })
    })
    let setSession: (tenantId: string, siteId: string) => void = () => undefined
    const switchSite = vi.fn(async () => undefined)
    const switchTenant = vi.fn(async () => {
      // The session is refreshed first and reports the new tenant while its sites are still on the way.
      act(() => setSession('t2', 's-default'))
    })
    renderShell({ switchTenant, switchSite, onSession: (set) => (setSession = set) })

    await waitFor(() => expect(switchTenant).toHaveBeenCalledWith('t2'))
    await waitFor(() => expect(mocks.fetchJsonWithAuth).toHaveBeenCalledTimes(2))

    // The list of the old tenant (s1) is cached, but it is not the list of t2: the link must wait, not be refused.
    expect(mocks.toastError).not.toHaveBeenCalled()
    expect(screen.getByTestId('resolving')).toHaveTextContent('true')

    await act(async () => t2Sites([{ id: 's-default' }, { id: 's2' }]))
    await waitFor(() => expect(switchSite).toHaveBeenCalledWith('s2'))
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('ends on the start page when a confirmed tenant switch fails after the unsynced-data prompt', async () => {
    mocks.fetchJsonWithAuth.mockResolvedValue([{ id: 's1' }])
    mocks.hasUnsynced.mockReturnValue(true)
    const switchTenant = vi.fn(async () => {
      throw new Error('network')
    })
    renderShell({ switchTenant, switchSite: vi.fn() })

    fireEvent.click(await screen.findByTestId('confirm'))

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent(/^\/$/))
    expect(screen.getByTestId('resolving')).toHaveTextContent('false')
    expect(switchTenant).toHaveBeenCalledTimes(1)
    expect(mocks.toastError).toHaveBeenCalledTimes(1)
  })
})
