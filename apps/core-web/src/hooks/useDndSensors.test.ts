import { describe, expect, it } from 'vitest'
import { DND_GRIP_HANDLE_ATTR, isGripHandleTouch } from './useDndSensors'

function makeTouchEvent(target: EventTarget | null): Event {
  const event = new Event('touchstart')
  Object.defineProperty(event, 'target', { value: target })
  return event
}

describe('isGripHandleTouch', () => {
  it('returns true when touch target is the grip button or its child icon', () => {
    const card = document.createElement('div')
    const grip = document.createElement('button')
    grip.setAttribute(DND_GRIP_HANDLE_ATTR, 'true')
    const icon = document.createElement('span')
    grip.appendChild(icon)
    card.appendChild(grip)

    expect(isGripHandleTouch({ activeNode: card, event: makeTouchEvent(grip) })).toBe(true)
    expect(isGripHandleTouch({ activeNode: card, event: makeTouchEvent(icon) })).toBe(true)
    expect(isGripHandleTouch({ activeNode: null, event: makeTouchEvent(grip) })).toBe(true)
  })

  it('returns false without throwing for card body and non-element targets', () => {
    const card = document.createElement('div')
    const cardBody = document.createElement('div')
    card.appendChild(cardBody)

    expect(isGripHandleTouch({ activeNode: card, event: makeTouchEvent(cardBody) })).toBe(false)
    expect(isGripHandleTouch({ activeNode: null, event: makeTouchEvent(cardBody) })).toBe(false)
    expect(isGripHandleTouch({ activeNode: null, event: makeTouchEvent(null) })).toBe(false)
  })
})
