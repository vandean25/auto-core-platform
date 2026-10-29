import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ purge: vi.fn(), toastError: vi.fn() }))

vi.mock('@/features/workshop/check-in/check-in-offline-store', () => ({ purgeAllCheckInOfflineData: mocks.purge }))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: vi.fn() } }))
vi.mock('@/features/workshop/check-in/CheckInOfflinePurgeDialog', () => ({
  CheckInOfflinePurgeDialog: (props: { onCancel: () => void; onConfirm: () => void }) => (
    <div>
      <button type='button' aria-label={'x'} data-testid='cancel' onClick={props.onCancel} />
      <button type='button' aria-label={'y'} data-testid='confirm' onClick={props.onConfirm} />
    </div>
  ),
}))

import { ShellPurgePrompt } from './ShellPurgePrompt'

const summary = { unsynced: 1 } as never

function setup(prompt: Parameters<typeof ShellPurgePrompt>[0]['prompt'], overrides = {}) {
  const props = {
    prompt,
    onClose: vi.fn(),
    onCancel: vi.fn(),
    onSwitchFailed: vi.fn(),
    completeTenantSwitch: vi.fn(async () => undefined),
    signOutUser: vi.fn(async () => undefined),
    ...overrides,
  }
  render(<ShellPurgePrompt {...props} />)
  return props
}

describe('ShellPurgePrompt', () => {
  beforeEach(() => {
    mocks.purge.mockReset().mockResolvedValue(undefined)
    mocks.toastError.mockReset()
  })

  it('confirms a tenant switch: closes and switches', async () => {
    const props = setup({ kind: 'switchTenant', tenantId: 't2', summary })
    fireEvent.click(screen.getByTestId('confirm'))
    await waitFor(() => expect(props.completeTenantSwitch).toHaveBeenCalledWith('t2'))
    expect(props.onClose).toHaveBeenCalled()
    expect(props.signOutUser).not.toHaveBeenCalled()
  })

  it('reports a failed tenant switch and tells the caller, so a waiting push link can give up', async () => {
    const props = setup({ kind: 'switchTenant', tenantId: 't2', summary }, { completeTenantSwitch: vi.fn(async () => Promise.reject(new Error('x'))) })
    fireEvent.click(screen.getByTestId('confirm'))
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1))
    expect(props.onSwitchFailed).toHaveBeenCalledTimes(1)
  })

  it('confirms a sign-out: discards the offline data, then signs out', async () => {
    const props = setup({ kind: 'signOut', summary })
    fireEvent.click(screen.getByTestId('confirm'))
    await waitFor(() => expect(props.signOutUser).toHaveBeenCalledTimes(1))
    expect(mocks.purge).toHaveBeenCalled()
  })

  it('on cancel closes and tells the caller, without switching or signing out', () => {
    const props = setup({ kind: 'switchTenant', tenantId: 't2', summary })
    fireEvent.click(screen.getByTestId('cancel'))
    expect(props.onClose).toHaveBeenCalled()
    expect(props.onCancel).toHaveBeenCalled()
    expect(props.completeTenantSwitch).not.toHaveBeenCalled()
  })
})
