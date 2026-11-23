import {
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { TouchSensorOptions } from '@dnd-kit/core'

const MOUSE_SENSOR_OPTIONS = { activationConstraint: { distance: 5 } }

export const DND_GRIP_HANDLE_ATTR = 'data-dnd-grip-handle'

export function isGripHandleTouch({
  event,
}: {
  activeNode?: unknown
  event: Event
}): boolean {
  const target = event.target
  const element =
    target instanceof Element ? target : target instanceof Node ? target.parentElement : null
  return Boolean(element?.closest(`[${DND_GRIP_HANDLE_ATTR}]`))
}

const TOUCH_SENSOR_OPTIONS: TouchSensorOptions = {
  activationConstraint: { delay: 250, tolerance: 8 },
  bypassActivationConstraint: isGripHandleTouch,
}

export interface UseDndSensorsOptions {
  enableKeyboard?: boolean
}

export function useDndSensors({ enableKeyboard = true }: UseDndSensorsOptions = {}) {
  const mouseSensor = useSensor(MouseSensor, MOUSE_SENSOR_OPTIONS)
  const touchSensor = useSensor(TouchSensor, TOUCH_SENSOR_OPTIONS)
  const keyboardSensor = useSensor(KeyboardSensor)
  return useSensors(mouseSensor, touchSensor, enableKeyboard ? keyboardSensor : null)
}
