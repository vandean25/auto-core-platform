import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { VehicleOpenDueDate } from '@/api/vehicles'
import { registerGermanUiForTests } from '@/test/german-ui'
import { VehicleOpenDueDates } from './VehicleOpenDueDates'

const dueByDate: VehicleOpenDueDate = {
  id: 'due-1',
  title: 'Service',
  due_date: '2026-11-30',
  due_mileage: null,
  external_ref: 'SRV-1',
  source: 'LEGACY_IMPORT',
}
const dueByMileage: VehicleOpenDueDate = {
  id: 'due-2',
  title: 'Zahnriemen',
  due_date: null,
  due_mileage: 120000,
  external_ref: null,
  source: 'MANUAL',
}

registerGermanUiForTests()

describe('VehicleOpenDueDates', () => {
  afterEach(() => cleanup())

  it('lists open due dates by date and by mileage', () => {
    render(<VehicleOpenDueDates dueDates={[dueByDate, dueByMileage]} />)

    expect(screen.getByText('Offene Fälligkeiten')).toBeInTheDocument()
    expect(screen.getByText('Service')).toBeInTheDocument()
    expect(screen.getByText(/Fällig am 30\.11\.2026/)).toBeInTheDocument()
    expect(screen.getByText('Zahnriemen')).toBeInTheDocument()
    expect(screen.getByText(/Fällig bei .*km/)).toBeInTheDocument()
  })

  it('shows an empty state without open due dates', () => {
    render(<VehicleOpenDueDates dueDates={[]} />)

    expect(screen.getByText('Keine offenen Fälligkeiten.')).toBeInTheDocument()
  })
})
