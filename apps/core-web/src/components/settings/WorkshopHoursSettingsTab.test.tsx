import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { WorkshopHoursSettingsTab } from './WorkshopHoursSettingsTab'

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

vi.mock('@/api/auth-session', () => ({
  useAuthSession: () => ({
    data: { activeRole: 'ADMIN' },
    isLoading: false,
  }),
}))

vi.mock('@/api/workshop', () => ({
  useWorkshopSettings: () => ({
    data: defaultSettings,
    isLoading: false,
  }),
  useWorkshopHolidays: () => ({
    data: { data: [] },
    isLoading: false,
  }),
  useUpdateWorkshopSettings: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteWorkshopHoliday: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useImportWorkshopHolidays: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateWorkshopHoliday: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateWorkshopHoliday: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

describe('WorkshopHoursSettingsTab', () => {
  it('renders hours form and holiday actions for admins', () => {
    render(
      <MemoryRouter>
        <WorkshopHoursSettingsTab />
      </MemoryRouter>,
    )

    expect(screen.getByText('Workshop hours')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save hours' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Holiday' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import public holidays' })).toBeInTheDocument()
    expect(screen.getByLabelText('Timezone')).toHaveValue('Europe/Vienna')
  })
})
