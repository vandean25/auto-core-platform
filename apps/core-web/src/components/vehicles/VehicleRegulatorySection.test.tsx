import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  VehicleRegulatorySection,
  type VehicleRegulatoryValues,
} from './VehicleRegulatorySection'
import { changeUiLanguage } from '@/lib/i18n'
import { registerGermanUiForTests } from '@/test/german-ui'
import { VEHICLE_REGULATORY_FIELDS } from './vehicle-regulatory-copy'

registerGermanUiForTests()

const german = (copy: { de: string }) => copy.de

const emptyValues: VehicleRegulatoryValues = {
  first_registration_date: null,
  co2_wltp_g_km: null,
  co2_nedc_g_km: null,
  typenschein_no: null,
  nova_class: null,
  emission_class: null,
}

describe('VehicleRegulatorySection', () => {
  it('shows the first registration as TT.MM.JJJJ in a text field, whatever the browser locale', () => {
    render(
      <VehicleRegulatorySection
        mode="form"
        values={{ ...emptyValues, first_registration_date: '2024-01-15' }}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByLabelText(german(VEHICLE_REGULATORY_FIELDS.firstRegistrationDate))).toHaveValue('15.01.2024')
    expect(document.querySelector('input[type="date"]')).toBeNull()
  })

  it('clears the first registration when the text is emptied', () => {
    const onChange = vi.fn()
    render(
      <VehicleRegulatorySection
        mode="form"
        values={{ ...emptyValues, first_registration_date: '2024-01-15' }}
        onChange={onChange}
      />,
    )

    fireEvent.change(screen.getByLabelText(german(VEHICLE_REGULATORY_FIELDS.firstRegistrationDate)), { target: { value: '' } })

    expect(onChange).toHaveBeenCalledWith({ first_registration_date: null })
  })

  it('renders all six labels in form mode and calls onChange', () => {
    const onChange = vi.fn()

    render(
      <VehicleRegulatorySection mode="form" values={emptyValues} onChange={onChange} />,
    )

    expect(
      screen.getByText(german(VEHICLE_REGULATORY_FIELDS.firstRegistrationDate)),
    ).toBeInTheDocument()
    expect(screen.getByText(german(VEHICLE_REGULATORY_FIELDS.co2Wltp))).toBeInTheDocument()
    expect(screen.getByText(german(VEHICLE_REGULATORY_FIELDS.co2Nedc))).toBeInTheDocument()
    expect(
      screen.getByText(german(VEHICLE_REGULATORY_FIELDS.typenscheinNo)),
    ).toBeInTheDocument()
    expect(screen.getByText(german(VEHICLE_REGULATORY_FIELDS.novaClass))).toBeInTheDocument()
    expect(
      screen.getByText(german(VEHICLE_REGULATORY_FIELDS.emissionClass)),
    ).toBeInTheDocument()

    const typenscheinInput = screen.getByLabelText(german(VEHICLE_REGULATORY_FIELDS.typenscheinNo))
    fireEvent.change(typenscheinInput, { target: { value: 'TS-99' } })
    expect(onChange).toHaveBeenCalledWith({ typenschein_no: 'TS-99' })

    const dateInput = screen.getByLabelText(german(VEHICLE_REGULATORY_FIELDS.firstRegistrationDate))
    fireEvent.change(dateInput, { target: { value: '15.01.2024' } })
    expect(onChange).toHaveBeenCalledWith({ first_registration_date: '2024-01-15' })

    const co2Input = screen.getAllByRole('spinbutton')[0]
    fireEvent.change(co2Input, { target: { value: '142' } })
    expect(onChange).toHaveBeenCalledWith({ co2_wltp_g_km: 142 })
  })

  it('shows a single language, never both at once', async () => {
    await changeUiLanguage('en')
    render(<VehicleRegulatorySection mode="form" values={emptyValues} onChange={vi.fn()} />)

    expect(screen.getByText(VEHICLE_REGULATORY_FIELDS.firstRegistrationDate.en)).toBeInTheDocument()
    expect(screen.queryByText(/ \/ /)).not.toBeInTheDocument()
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
