import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  VehicleRegulatorySection,
  type VehicleRegulatoryValues,
} from './VehicleRegulatorySection'
import { bilingualLabel, VEHICLE_REGULATORY_FIELDS } from './vehicle-regulatory-copy'

const emptyValues: VehicleRegulatoryValues = {
  first_registration_date: null,
  co2_wltp_g_km: null,
  co2_nedc_g_km: null,
  typenschein_no: null,
  nova_class: null,
  emission_class: null,
}

describe('VehicleRegulatorySection', () => {
  it('renders all six labels in form mode and calls onChange', () => {
    const onChange = vi.fn()

    render(
      <VehicleRegulatorySection mode="form" values={emptyValues} onChange={onChange} />,
    )

    expect(
      screen.getByText(bilingualLabel(VEHICLE_REGULATORY_FIELDS.firstRegistrationDate)),
    ).toBeInTheDocument()
    expect(screen.getByText(bilingualLabel(VEHICLE_REGULATORY_FIELDS.co2Wltp))).toBeInTheDocument()
    expect(screen.getByText(bilingualLabel(VEHICLE_REGULATORY_FIELDS.co2Nedc))).toBeInTheDocument()
    expect(
      screen.getByText(bilingualLabel(VEHICLE_REGULATORY_FIELDS.typenscheinNo)),
    ).toBeInTheDocument()
    expect(screen.getByText(bilingualLabel(VEHICLE_REGULATORY_FIELDS.novaClass))).toBeInTheDocument()
    expect(
      screen.getByText(bilingualLabel(VEHICLE_REGULATORY_FIELDS.emissionClass)),
    ).toBeInTheDocument()

    const typenscheinInput = screen.getAllByRole('textbox')[0]
    fireEvent.change(typenscheinInput, { target: { value: 'TS-99' } })
    expect(onChange).toHaveBeenCalledWith({ typenschein_no: 'TS-99' })

    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement
    fireEvent.change(dateInput, { target: { value: '2024-01-15' } })
    expect(onChange).toHaveBeenCalledWith({ first_registration_date: '2024-01-15' })

    const co2Input = screen.getAllByRole('spinbutton')[0]
    fireEvent.change(co2Input, { target: { value: '142' } })
    expect(onChange).toHaveBeenCalledWith({ co2_wltp_g_km: 142 })
  })

  it('calls renderInlineField for five text fields in inline mode', () => {
    const renderInlineField = vi.fn((_field, label) => (
      <div key={label}>{label}</div>
    ))

    render(
      <VehicleRegulatorySection
        mode="inline"
        values={emptyValues}
        onChange={vi.fn()}
        renderInlineField={renderInlineField}
      />,
    )

    expect(renderInlineField).toHaveBeenCalledTimes(5)
  })
})
