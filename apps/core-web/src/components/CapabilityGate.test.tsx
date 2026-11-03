import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AuthSession } from '@/api/auth-session'
import { CapabilityGate } from './CapabilityGate'

const mocks = vi.hoisted(() => ({
  session: undefined as { data?: Partial<AuthSession> } | undefined,
}))

vi.mock('@/api/auth-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/auth-session')>()),
  useAuthSession: () => mocks.session,
}))

afterEach(() => {
  cleanup()
  mocks.session = undefined
})

describe('CapabilityGate (AUT-686)', () => {
  it('renders children when the capability is on', () => {
    mocks.session = { data: { effectiveCapabilities: { nova: true, pickerl57a: false, kaufvertragAt: false, willhabenExport: false } } }

    render(<CapabilityGate capability="nova"><p>NoVA content</p></CapabilityGate>)

    expect(screen.getByText('NoVA content')).toBeInTheDocument()
  })

  // Regression guard: a loading or null session must hide gated content, not show it.
  it.each([
    ['capability is off', { data: { effectiveCapabilities: { nova: false, pickerl57a: true, kaufvertragAt: true, willhabenExport: true } } }],
    ['capabilities are null', { data: { effectiveCapabilities: null } }],
    ['the session is still loading', { data: undefined }],
  ])('renders the fallback and no children when %s', (_case, session) => {
    mocks.session = session as { data?: Partial<AuthSession> }

    render(
      <CapabilityGate capability="nova" fallback={<p>Not available</p>}>
        <p>NoVA content</p>
      </CapabilityGate>,
    )

    expect(screen.queryByText('NoVA content')).not.toBeInTheDocument()
    expect(screen.getByText('Not available')).toBeInTheDocument()
  })
})
