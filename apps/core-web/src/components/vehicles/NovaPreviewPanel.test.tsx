import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { useNovaCalculate } = vi.hoisted(() => ({
  useNovaCalculate: vi.fn(),
}))

vi.mock('@/api/nova', () => ({ useNovaCalculate }))

import { NovaPreviewPanel } from './NovaPreviewPanel'

describe('NovaPreviewPanel', () => {
  const calculate = vi.fn()
  const reset = vi.fn()

  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    useNovaCalculate.mockReturnValue({
      mutate: calculate,
      reset,
      data: undefined,
      error: null,
      isPending: false,
    })
  })

  it('submits the vehicle ID and net price for a calculation', () => {
    render(
      <NovaPreviewPanel
        vehicleId="vehicle-1"
        firstRegistrationDate="2025-01-02"
        co2Wltp={160}
        co2Nedc={null}
        typenscheinNo="TS-1"
        novaClass="STANDARD"
      />,
    )

    fireEvent.change(screen.getByLabelText('NoVA-Netto-Preis'), {
      target: { value: '25000' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'NoVA berechnen' }))

    expect(calculate).toHaveBeenCalledWith({
      vehicleId: 'vehicle-1',
      netPriceEuro: 25000,
    })
  })

  it('shows the tariff, applied rules, and adviser note for an unverified rule', () => {
    useNovaCalculate.mockReturnValue({
      mutate: calculate,
      reset,
      data: {
        novaAmountEuro: 1234.5,
        tariffVersionId: 'at-m1-2025-h1',
        appliedRuleIds: ['tariff.co2_rate_formula'],
        warnings: ['nedc_fractional_co2_unverified'],
        hasUnverifiedRules: true,
        ratePercentApplied: 14,
        effectiveCo2GramsPerKm: 165.1,
      },
      error: null,
      isPending: false,
    })

    render(
      <NovaPreviewPanel
        vehicleId="vehicle-1"
        firstRegistrationDate="2025-01-02"
        co2Wltp={null}
        co2Nedc={130}
        typenscheinNo="TS-1"
        novaClass="STANDARD"
      />,
    )

    fireEvent.change(screen.getByLabelText('NoVA-Netto-Preis'), {
      target: { value: '25000' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'NoVA berechnen' }))

    expect(screen.getByText('at-m1-2025-h1')).toBeInTheDocument()
    expect(
      screen.getByText(
        (_text, element) =>
          element?.textContent === 'Angewandte Regeln: tariff.co2_rate_formula',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Vorschau - Steuerberater-Bestätigung ausstehend'),
    ).toBeInTheDocument()
    expect(screen.getByText('CO₂ NEDC (g/km): 130')).toBeInTheDocument()
  })

  it('clears a previous result when the net price changes', () => {
    useNovaCalculate.mockReturnValue({
      mutate: calculate,
      reset,
      data: {
        novaAmountEuro: 1234.5,
        tariffVersionId: 'at-m1-2025-h2',
        appliedRuleIds: [],
        warnings: [],
        hasUnverifiedRules: false,
        ratePercentApplied: 12,
        effectiveCo2GramsPerKm: 160,
      },
      error: null,
      isPending: false,
    })

    render(
      <NovaPreviewPanel
        vehicleId="vehicle-1"
        firstRegistrationDate="2025-01-02"
        co2Wltp={160}
        co2Nedc={null}
        typenscheinNo="TS-1"
        novaClass="STANDARD"
      />,
    )

    fireEvent.change(screen.getByLabelText('NoVA-Netto-Preis'), {
      target: { value: '25000' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'NoVA berechnen' }))
    expect(screen.getByText('at-m1-2025-h2')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('NoVA-Netto-Preis'), {
      target: { value: '26000' },
    })

    expect(screen.queryByText('at-m1-2025-h2')).not.toBeInTheDocument()
  })

  it('shows a missing CO2 hint without raising a toast', () => {
    useNovaCalculate.mockReturnValue({
      mutate: calculate,
      reset,
      data: undefined,
      error: Object.assign(new Error('CO2 required'), { code: 'MISSING_CO2' }),
      isPending: false,
    })

    render(
      <NovaPreviewPanel
        vehicleId="vehicle-1"
        firstRegistrationDate={null}
        co2Wltp={null}
        co2Nedc={null}
        typenscheinNo={null}
        novaClass={null}
      />,
    )

    expect(screen.getByText('CO2 fehlt')).toBeInTheDocument()
  })
})
