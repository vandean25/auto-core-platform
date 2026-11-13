import * as React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWithAuth } from '@/api/client'
import type { MeSite } from '@/api/sites'
import { ActiveSiteGate } from './ActiveSiteGate'

vi.mock('@/lib/firebase', () => ({ firebaseAuth: { currentUser: null } }))
vi.mock('@/lib/runtime-flags', () => ({
  getE2ETestToken: () => null,
  isE2ETestTokenAuthEnabled: () => false,
}))

const SITES: MeSite[] = [
  { id: 'site-main', code: 'MAIN', name: 'Wien', legalEntityId: 'le-1' },
  { id: 'site-grz', code: 'GRZ', name: 'Graz', legalEntityId: 'le-1' },
]

/** Stands in for a site list page: it asks for its rows when it mounts and shows a skeleton until then. */
function WorkOrderList({ onRequest }: { onRequest: () => void }) {
  React.useEffect(onRequest, [onRequest])
  return <div data-testid="wo-list-skeleton" />
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ActiveSiteGate (AUT-979)', () => {
  // Regression: after a switch to a tenant with several sites the WO list mounted without a site and hung in skeleton.
  it('opens the site picker without sending a list request when no site is active', () => {
    const onRequest = vi.fn()
    const onPickSite = vi.fn()
    render(
      <ActiveSiteGate activeSiteId={null} sites={SITES} sitesLoading={false} onPickSite={onPickSite}>
        <WorkOrderList onRequest={onRequest} />
      </ActiveSiteGate>,
    )

    expect(screen.getByRole('heading', { name: 'Standort wählen' })).toBeInTheDocument()
    expect(onRequest).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Graz aktivieren' }))
    expect(onPickSite).toHaveBeenCalledWith('site-grz')
  })

  // Regression: a 422 ACTIVE_SITE_REQUIRED left the page in its skeleton with no message.
  it('replaces the page with the site picker when an API call answers 422 ACTIVE_SITE_REQUIRED', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ statusCode: 422, error: 'ACTIVE_SITE_REQUIRED', code: 'HTTP_422' }), {
          status: 422,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    render(
      <ActiveSiteGate activeSiteId="site-main" sites={SITES} sitesLoading={false} onPickSite={vi.fn()}>
        <WorkOrderList onRequest={vi.fn()} />
      </ActiveSiteGate>,
    )
    expect(screen.getByTestId('wo-list-skeleton')).toBeInTheDocument()

    await act(async () => {
      await fetchWithAuth('/api/workshop/orders')
    })

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Standort wählen' })).toBeInTheDocument())
    expect(screen.queryByTestId('wo-list-skeleton')).not.toBeInTheDocument()
  })
})
