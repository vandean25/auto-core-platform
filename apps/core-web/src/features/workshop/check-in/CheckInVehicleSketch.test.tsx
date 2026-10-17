import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CheckInVehicleSketch } from './CheckInVehicleSketch'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('CheckInVehicleSketch', () => {
  it('selects a zone when the sketch is tapped', async () => {
    const onZoneSelect = vi.fn()

    render(
      <CheckInVehicleSketch
        selectedZoneId="FRONT_BUMPER"
        markedZoneIds={new Set()}
        disabled={false}
        onZoneSelect={onZoneSelect}
      />,
    )

    const sketch = screen.getByTestId('check-in-vehicle-sketch')
    const rearBumper = sketch.querySelector('#REAR_BUMPER')
    expect(rearBumper).toBeTruthy()

    fireEvent.pointerDown(rearBumper as Element)
    expect(onZoneSelect).toHaveBeenCalledWith('REAR_BUMPER')
  })
})
