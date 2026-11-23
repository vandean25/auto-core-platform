import { describe, expect, it } from 'vitest'
import { isGripHandleTouch } from './useDndSensors'

function makeTouchEvent(target: EventTarget): Event {
  const event = new Event('touchstart')
  Object.defineProperty(event, 'target', { value: target })
  return event
}

describe('isGripHandleTouch', () => {
  it('returns true when touch target is the grip button or its child icon', () => {
    const grip = document.createElement('button')
    const icon = document.createElement('span')
    grip.appendChild(icon)

    const activeNode = { activatorNode: { current: grip } }

    expect(isGripHandleTouch({ activeNode, event: makeTouchEvent(grip) })).toBe(true)
    expect(isGripHandleTouch({ activeNode, event: makeTouchEvent(icon) })).toBe(true)
  })

  it('returns false when touch target is on the card body outside the grip button', () => {
    const grip = document.createElement('button')
    const cardBody = document.createElement('div')

    const activeNode = { activatorNode: { current: grip } }

    expect(isGripHandleTouch({ activeNode, event: makeTouchEvent(cardBody) })).toBe(false)
  })
})
