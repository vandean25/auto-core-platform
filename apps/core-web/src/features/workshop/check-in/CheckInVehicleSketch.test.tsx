import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CheckInVehicleSketch } from './CheckInVehicleSketch'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('CheckInVehicleSketch', () => {
  it('selects a zone when the sketch is tapped', async () => {
    // useEffect wires click handlers on SVG zone groups after mount.
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
    await waitFor(() => {
      expect(sketch.querySelector('#LEFT_FRONT_WING')).toBeTruthy()
    })
    const frontWing = sketch.querySelector('#LEFT_FRONT_WING') as Element
    const hitTarget =
      frontWing.querySelector('rect[fill="transparent"]') ?? frontWing

    fireEvent.click(hitTarget)
    expect(onZoneSelect).toHaveBeenCalledWith('LEFT_FRONT_WING')
  })
})
