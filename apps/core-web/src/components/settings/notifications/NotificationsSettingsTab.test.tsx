import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import deCommon from '../../../../../../locales/de/common.json'
import deSettings from '../../../../../../locales/de/settings.json'
import { NotificationsSettingsTab } from './NotificationsSettingsTab'

const mocks = vi.hoisted(() => ({
  support: 'ready' as 'ready' | 'off' | 'install-required' | 'unsupported',
  permission: 'default' as NotificationPermission | 'unsupported',
  storedDeviceId: null as string | null,
  devices: [] as Array<Record<string, unknown>>,
  preferences: { enabledEvents: [] as string[], quietStartMin: null as number | null, quietEndMin: null as number | null },
  enablePushOnThisDevice: vi.fn(),
  disablePushOnThisDevice: vi.fn(),
  updatePreferences: vi.fn(),
  sendTest: vi.fn(),
  revoke: vi.fn(),
}))

vi.mock('@/features/push/push-device', () => ({
  PushPermissionError: class extends Error {},
  getPushSupport: () => mocks.support,
  getNotificationPermission: () => mocks.permission,
  getStoredDeviceId: () => mocks.storedDeviceId,
  enablePushOnThisDevice: mocks.enablePushOnThisDevice,
  disablePushOnThisDevice: mocks.disablePushOnThisDevice,
}))
vi.mock('@/api/push', () => ({
  PUSH_USER_EVENT_TYPES: ['CUSTOMER_ESTIMATE_DECIDED', 'WORKSHOP_TASK_WAITING_CUSTOMER'],
  pushKeys: { devices: () => ['push', 'devices'] },
  usePushDevices: () => ({ data: mocks.devices }),
  usePushPreferences: () => ({ data: mocks.preferences }),
  useUpdatePushPreferences: () => ({ mutateAsync: mocks.updatePreferences, isPending: false }),
  useSendTestPush: () => ({ mutateAsync: mocks.sendTest, isPending: false }),
  useRevokePushDevice: () => ({ mutateAsync: mocks.revoke, isPending: false }),
}))

const t = deSettings.notifications

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <NotificationsSettingsTab />
    </QueryClientProvider>,
  )
}

describe('NotificationsSettingsTab', () => {
  beforeEach(() => {
    mocks.support = 'ready'
    mocks.permission = 'default'
    mocks.storedDeviceId = null
    mocks.devices = []
    mocks.preferences = { enabledEvents: [], quietStartMin: null, quietEndMin: null }
    mocks.enablePushOnThisDevice.mockReset().mockResolvedValue({ id: 'device-1' })
    mocks.disablePushOnThisDevice.mockReset().mockResolvedValue(undefined)
    mocks.updatePreferences.mockReset().mockResolvedValue(undefined)
    mocks.sendTest.mockReset().mockResolvedValue({ id: 'o1' })
    mocks.revoke.mockReset().mockResolvedValue(undefined)
  })

  it('does not ask for the permission on load, only when the button is pressed', async () => {
    renderTab()

    expect(mocks.enablePushOnThisDevice).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: t.device.enable }))

    await waitFor(() => expect(mocks.enablePushOnThisDevice).toHaveBeenCalledTimes(1))
  })

  it.each([
    ['off', t.device.off],
    ['install-required', t.device.installRequired],
    ['unsupported', t.device.unsupported],
  ] as const)('shows the %s explanation and no enable button', (support, text) => {
    mocks.support = support
    renderTab()

    expect(screen.getByText(text)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.device.enable })).not.toBeInTheDocument()
  })

  it('explains how to re-enable a denied permission instead of offering the button', () => {
    mocks.permission = 'denied'
    renderTab()

    expect(screen.getByText(t.device.denied)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.device.enable })).not.toBeInTheDocument()
  })

  it('offers to disable push on a registered browser', async () => {
    mocks.permission = 'granted'
    mocks.storedDeviceId = 'device-1'
    mocks.devices = [{ id: 'device-1', platform: 'DESKTOP', browser: 'chrome', installed: false, lastSeenAt: '2026-10-28T10:00:00.000Z', createdAt: '2026-10-28T09:00:00.000Z' }]
    renderTab()

    fireEvent.click(screen.getByRole('button', { name: t.device.disable }))

    await waitFor(() => expect(mocks.disablePushOnThisDevice).toHaveBeenCalledTimes(1))
  })

  it('has every event off by default and saves a toggle at once', async () => {
    renderTab()

    const box = screen.getByRole('checkbox', { name: new RegExp(t.events.CUSTOMER_ESTIMATE_DECIDED.label) })
    expect(box).not.toBeChecked()
    fireEvent.click(box)

    await waitFor(() =>
      expect(mocks.updatePreferences).toHaveBeenCalledWith({
        enabledEvents: ['CUSTOMER_ESTIMATE_DECIDED'],
        quietStartMin: null,
        quietEndMin: null,
      }),
    )
  })

  it('saves quiet hours as minutes after midnight', async () => {
    renderTab()

    fireEvent.click(screen.getByRole('checkbox', { name: t.quietHours.enabled }))
    fireEvent.click(screen.getByRole('button', { name: deCommon.actions.save }))

    await waitFor(() =>
      expect(mocks.updatePreferences).toHaveBeenCalledWith({ enabledEvents: [], quietStartMin: 1320, quietEndMin: 360 }),
    )
  })

  it('does not offer the test push without a registered device', () => {
    renderTab()

    expect(screen.getByRole('button', { name: t.test.send })).toBeDisabled()
    expect(screen.getByText(t.devices.empty)).toBeInTheDocument()
  })

  it('sends a test push and removes a device on request', async () => {
    mocks.devices = [{ id: 'device-9', platform: 'IOS', browser: 'safari', installed: true, lastSeenAt: '2026-10-28T10:00:00.000Z', createdAt: '2026-10-28T09:00:00.000Z' }]
    renderTab()

    fireEvent.click(screen.getByRole('button', { name: t.test.send }))
    await waitFor(() => expect(mocks.sendTest).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: t.devices.remove }))
    await waitFor(() => expect(mocks.revoke).toHaveBeenCalledWith('device-9'))
  })
})
