import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkshopHoursSettingsTab } from './WorkshopHoursSettingsTab'

const { mocks, defaultSettings, sampleHoliday } = vi.hoisted(() => {
  const defaultSettings = {
    timezone: 'Europe/Vienna',
    slotMinutes: 30 as const,
    holidayCountryIso: 'AT',
    holidaySubdivisionCode: null,
    openingHours: [
      { weekday: 1, isClosed: false, openTime: '07:30', closeTime: '17:00' },
      { weekday: 2, isClosed: false, openTime: '07:30', closeTime: '17:00' },
      { weekday: 3, isClosed: false, openTime: '07:30', closeTime: '17:00' },
      { weekday: 4, isClosed: false, openTime: '07:30', closeTime: '17:00' },
      { weekday: 5, isClosed: false, openTime: '07:30', closeTime: '17:00' },
      { weekday: 6, isClosed: false, openTime: '08:00', closeTime: '12:00' },
      { weekday: 7, isClosed: true, openTime: '07:30', closeTime: '17:00' },
    ],
  }

  const sampleHoliday = {
    id: 'holiday-1',
    name: 'Betriebsurlaub',
    observedOn: '2026-05-01',
    repeatsAnnually: false,
    isClosed: true,
    openTime: null,
    closeTime: null,
    source: 'MANUAL' as const,
  }

  const mocks = {
    activeRole: 'ADMIN' as string,
    settings: defaultSettings,
    holidays: [] as (typeof sampleHoliday)[],
    isSettingsError: false,
    updateSettingsMutateAsync: vi.fn(),
    deleteHolidayMutateAsync: vi.fn(),
    importHolidaysMutateAsync: vi.fn(),
    createHolidayMutateAsync: vi.fn(),
    updateHolidayMutateAsync: vi.fn(),
  }

  return { mocks, defaultSettings, sampleHoliday }
})

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/api/auth-session', () => ({
  useAuthSession: () => ({
    data: { activeRole: mocks.activeRole },
    isLoading: false,
  }),
}))

vi.mock('@/api/workshop', () => ({
  useWorkshopSettings: () => ({
    data: mocks.settings,
    isLoading: false,
    isError: mocks.isSettingsError,
  }),
  useWorkshopHolidays: () => ({
    data: { data: mocks.holidays },
    isLoading: false,
  }),
  useUpdateWorkshopSettings: () => ({
    mutateAsync: mocks.updateSettingsMutateAsync,
    isPending: false,
  }),
  useDeleteWorkshopHoliday: () => ({
    mutateAsync: mocks.deleteHolidayMutateAsync,
    isPending: false,
  }),
  useImportWorkshopHolidays: () => ({
    mutateAsync: mocks.importHolidaysMutateAsync,
    isPending: false,
  }),
  useCreateWorkshopHoliday: () => ({
    mutateAsync: mocks.createHolidayMutateAsync,
    isPending: false,
  }),
  useUpdateWorkshopHoliday: () => ({
    mutateAsync: mocks.updateHolidayMutateAsync,
    isPending: false,
  }),
}))

function renderTab() {
  return render(
    <MemoryRouter>
      <WorkshopHoursSettingsTab />
    </MemoryRouter>,
  )
}

describe('WorkshopHoursSettingsTab', () => {
  beforeEach(() => {
    mocks.activeRole = 'ADMIN'
    mocks.settings = defaultSettings
    mocks.holidays = []
    mocks.isSettingsError = false
    mocks.updateSettingsMutateAsync.mockReset()
    mocks.deleteHolidayMutateAsync.mockReset()
    mocks.importHolidaysMutateAsync.mockReset()
    mocks.createHolidayMutateAsync.mockReset()
    mocks.updateHolidayMutateAsync.mockReset()
    mocks.updateSettingsMutateAsync.mockResolvedValue(defaultSettings)
    mocks.importHolidaysMutateAsync.mockResolvedValue({
      imported: 2,
      skipped: 0,
      yearFrom: 2026,
      yearTo: 2027,
    })
    mocks.createHolidayMutateAsync.mockResolvedValue(sampleHoliday)
    mocks.deleteHolidayMutateAsync.mockResolvedValue(undefined)
  })

  it('renders hours form and holiday actions for admins', () => {
    renderTab()

    expect(screen.getByText('Workshop hours')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save hours' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Holiday' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import public holidays' })).toBeInTheDocument()
    expect(screen.getByLabelText('Timezone')).toHaveValue('Europe/Vienna')
  })

  it('saves timezone and weekday hours for admins', async () => {
    renderTab()

    fireEvent.change(screen.getByLabelText('Timezone'), {
      target: { value: 'Europe/Berlin' },
    })

    const wednesdayRow = screen.getByText('Wednesday').closest('div')
    const timeInputs = wednesdayRow?.querySelectorAll('input[type="time"]')
    expect(timeInputs).toHaveLength(2)
    fireEvent.change(timeInputs![0], { target: { value: '08:00:00' } })
    fireEvent.change(timeInputs![1], { target: { value: '16:00:00' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save hours' }))

    await waitFor(() => {
      expect(mocks.updateSettingsMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          timezone: 'Europe/Berlin',
          openingHours: expect.arrayContaining([
            expect.objectContaining({
              weekday: 3,
              openTime: '08:00',
              closeTime: '16:00',
            }),
          ]),
        }),
      )
    })
  })

  it('hides write controls and disables fields for SALES', () => {
    mocks.activeRole = 'SALES'
    renderTab()

    expect(screen.queryByRole('button', { name: 'Save hours' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Holiday' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Import public holidays' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Timezone')).toBeDisabled()
  })

  it('creates an annual holiday from the dialog', async () => {
    renderTab()

    fireEvent.click(screen.getByRole('button', { name: '+ Holiday' }))

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Company day' },
    })
    fireEvent.change(screen.getByLabelText('Date'), {
      target: { value: '2026-08-15' },
    })
    fireEvent.click(screen.getByLabelText('Repeats annually (same month and day)'))

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(mocks.createHolidayMutateAsync).toHaveBeenCalledWith({
        name: 'Company day',
        observedOn: '2026-08-15',
        repeatsAnnually: true,
        isClosed: true,
      })
    })
  })

  it('deletes a holiday from the row context menu', async () => {
    mocks.holidays = [sampleHoliday]
    renderTab()

    fireEvent.contextMenu(screen.getByText('Betriebsurlaub'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(mocks.deleteHolidayMutateAsync).toHaveBeenCalledWith('holiday-1')
    })
  })

  it('imports public holidays for admins', async () => {
    renderTab()

    fireEvent.click(screen.getByRole('button', { name: 'Import public holidays' }))

    await waitFor(() => {
      expect(mocks.importHolidaysMutateAsync).toHaveBeenCalledWith({})
    })
  })
})
