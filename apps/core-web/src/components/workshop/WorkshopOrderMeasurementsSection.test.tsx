import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkshopOrderMeasurementsSection } from './WorkshopOrderMeasurementsSection'

vi.mock('@/api/workshop-measurements', () => ({
  useWorkshopMeasurements: () => ({
    data: {
      data: [
        {
          id: 'import-1',
          state: 'APPLIED',
          native_measurement_reference: 'SYNTH-NATIVE-RESULT-1',
          quarantine_reason: null,
        },
      ],
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
  it('renders applied measurement history', () => {
    render(<WorkshopOrderMeasurementsSection orderId='order-1' />)
    expect(screen.getByText('Geräteergebnis Bremsen')).toBeInTheDocument()
    expect(screen.getByText('SYNTH-NATIVE-RESULT-1')).toBeInTheDocument()
    expect(screen.getByText('Übernommen')).toBeInTheDocument()
  })
})
