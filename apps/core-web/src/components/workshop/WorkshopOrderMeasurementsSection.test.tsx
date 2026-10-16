import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { describeMeasurementError } from '@/api/measurement-errors'
import { WorkshopOrderMeasurementsSection } from './WorkshopOrderMeasurementsSection'

vi.mock('@/api/workshop-measurements', () => ({
  useWorkshopMeasurements: (_orderId: string, page = 1) => ({
    data: {
      data: [
        {
          id: 'import-1',
          state: 'APPLIED',
          native_measurement_reference: 'SYNTH-NATIVE-RESULT-1',
          quarantine_reason: null,
          applied_measurement: {
            device_serial: 'SYNTH-BRAKE-SERIAL-1',
            wheels: [
              { axle: 1, side: 'LEFT', force: '2.100', unit: 'kN' },
              { axle: 1, side: 'RIGHT', force: '2.000', unit: 'kN' },
              { axle: 2, side: 'LEFT', force: '1.200', unit: 'kN' },
              { axle: 2, side: 'RIGHT', force: '1.100', unit: 'kN' },
            ],
          },
        },
      ],
      meta: { total: 51, page, pageSize: 50, pageCount: 2 },
    },
  }),
  useInspectionDeviceSources: () => ({
    data: {
      data: [
        {
          id: 'device-1',
          device_serial: 'SYNTH-BRAKE-SERIAL-1',
          device_model: 'SYNTH-BRAKE-MODEL',
        },
      ],
    },
  }),
  usePreviewWorkshopMeasurement: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    reset: vi.fn(),
  }),
  useApplyWorkshopMeasurement: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    reset: vi.fn(),
  }),
}))

describe('WorkshopOrderMeasurementsSection', () => {
  it('renders applied measurement history with German labels and paging', () => {
    render(<WorkshopOrderMeasurementsSection orderId='order-1' />)
    expect(screen.getByText('Geräteergebnis Bremsen')).toBeInTheDocument()
    expect(screen.getByText('SYNTH-NATIVE-RESULT-1')).toBeInTheDocument()
    expect(screen.getByText('Übernommen')).toBeInTheDocument()
    expect(screen.getByText(/Achse 1 links/)).toBeInTheDocument()
    expect(screen.getByText('Gerät: SYNTH-BRAKE-SERIAL-1')).toBeInTheDocument()
    expect(screen.getByText('Seite 1 / 2')).toBeInTheDocument()
  })

  it('maps measurement error codes to German copy', () => {
    expect(describeMeasurementError(new Error('DEVICE_BINDING_MISMATCH'))).toBe(
      'Gerätebindung stimmt nicht.',
    )
  })
})
