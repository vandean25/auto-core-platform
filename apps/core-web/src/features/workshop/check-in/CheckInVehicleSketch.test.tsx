import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CheckInVehicleSketch } from './CheckInVehicleSketch'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('CheckInVehicleSketch', () => {
  it('selects a zone when the wing panel is tapped', async () => {
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
    const wingHit = frontWing.querySelector('rect[fill="transparent"]') as Element

    fireEvent.click(wingHit)
    expect(onZoneSelect).toHaveBeenCalledWith('LEFT_FRONT_WING')
  })

  it('keeps wheel hit targets separate from wing pads and selects the wheel', async () => {
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
      expect(sketch.querySelector('#LEFT_FRONT_WHEEL')).toBeTruthy()
    })

    const wheelHit = sketch.querySelector(
      '#LEFT_FRONT_WHEEL rect[fill="transparent"]',
    ) as SVGRectElement
    const wingHit = sketch.querySelector(
      '#LEFT_FRONT_WING rect[fill="transparent"]',
    ) as SVGRectElement

    expect(Number(wheelHit.getAttribute('width'))).toBeGreaterThanOrEqual(22)
    expect(Number(wheelHit.getAttribute('height'))).toBeGreaterThanOrEqual(22)
    expect(Number(wingHit.getAttribute('x'))).toBeGreaterThanOrEqual(22)

    const wheelCenterX =
      Number(wheelHit.getAttribute('x') ?? 0) +
      Number(wheelHit.getAttribute('width') ?? 0) / 2
    const wingX = Number(wingHit.getAttribute('x') ?? 0)
    expect(wheelCenterX).toBeLessThan(wingX)

    fireEvent.click(wheelHit)
    expect(onZoneSelect).toHaveBeenCalledWith('LEFT_FRONT_WHEEL')
  })
})
