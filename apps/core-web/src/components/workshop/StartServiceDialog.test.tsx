import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StartServiceDialog } from './StartServiceDialog'
import * as workshopApi from '@/api/workshop'
import { expectFieldErrorLinked, expectFieldValid } from '@/test/form-a11y'
import { deWorkshop } from '@/test/de-workshop'
import deCommon from '../../../../../locales/de/common.json'
import { ensureNamespaceLoaded, i18n } from '@/lib/i18n'
import * as initI18n from '@/lib/i18n/init-i18n'
import { stripLazyNamespacesForTest } from '@/test/lazy-namespace-test-helpers'

const ss = deWorkshop.startService

vi.mock('@/api/workshop')
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('StartServiceDialog', () => {
  afterEach(() => {
    cleanup()
    void ensureNamespaceLoaded('workshop')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    ;(workshopApi.useCreateWorkshopOrder as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    })
  })

  it('links the required odometer error to its input', async () => {
    render(
      <StartServiceDialog
        open
        onOpenChange={vi.fn()}
        customerId="customer-1"
        vehicleId="vehicle-1"
        vehicleDescription="VW Golf"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: ss.submit }))

    await screen.findByText(ss.required)
    expectFieldErrorLinked(screen.getByLabelText(ss.odometer), ss.required)
    expectFieldValid(screen.getByLabelText(ss.fuelLevel))
  })

  it('links the fuel level range error to its input', async () => {
    render(
      <StartServiceDialog
        open
        onOpenChange={vi.fn()}
        customerId="customer-1"
        vehicleId="vehicle-1"
        vehicleDescription="VW Golf"
      />,
    )

    fireEvent.change(screen.getByLabelText(ss.odometer), { target: { value: '12000' } })
    fireEvent.change(screen.getByLabelText(ss.fuelLevel), { target: { value: '150' } })
    fireEvent.click(screen.getByRole('button', { name: ss.submit }))

    await screen.findByText(ss.fuelRange)
    expectFieldErrorLinked(screen.getByLabelText(ss.fuelLevel), ss.fuelRange)
    expectFieldValid(screen.getByLabelText(ss.odometer))
  })

  it('shows German start service copy when open after the workshop bundle loads', async () => {
    stripLazyNamespacesForTest()
    render(
      <StartServiceDialog
        open
        onOpenChange={vi.fn()}
        customerId="customer-1"
        vehicleId="vehicle-1"
        vehicleDescription="VW Golf"
      />,
    )

    expect(document.body.textContent).not.toMatch(/startService\./)
    expect(await screen.findByRole('heading', { name: ss.title })).toBeInTheDocument()
  })

  it('names the dialog and uses a tall retry when the workshop bundle fails', async () => {
    stripLazyNamespacesForTest()
    const ensureActual = initI18n.ensureNamespaceLoaded.bind(initI18n)
    for (const language of ['de', 'en'] as const) {
      i18n.removeResourceBundle(language, 'workshop')
    }
    const rejectSpy = vi.spyOn(initI18n, 'ensureNamespaceLoaded').mockImplementation((namespace) =>
      namespace === 'workshop' ? Promise.reject(new Error('chunk failed')) : ensureActual(namespace),
    )

    try {
      render(
        <StartServiceDialog
          open
          onOpenChange={vi.fn()}
          customerId="customer-1"
          vehicleId="vehicle-1"
          vehicleDescription="VW Golf"
        />,
      )

      expect(document.body.textContent).not.toMatch(/startService\./)
      expect(await screen.findByRole('heading', { name: deCommon.localeBundle.loadFailed })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: deCommon.localeBundle.retry })).toHaveClass('min-h-11')
    } finally {
      rejectSpy.mockRestore()
    }
  })

  it('renders no bundle gate copy while the dialog stays closed', () => {
    stripLazyNamespacesForTest()
    render(
      <StartServiceDialog
        open={false}
        onOpenChange={vi.fn()}
        customerId="customer-1"
        vehicleId="vehicle-1"
        vehicleDescription="VW Golf"
      />,
    )

    expect(screen.queryByText(deCommon.shell.loading)).not.toBeInTheDocument()
    expect(screen.queryByText(deCommon.localeBundle.loadFailed)).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
