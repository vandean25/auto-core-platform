import {
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { TouchSensorOptions } from '@dnd-kit/core'

const MOUSE_SENSOR_OPTIONS = { activationConstraint: { distance: 5 } }

export function isGripHandleTouch({
  activeNode,
  event,
}: {
  activeNode: { activatorNode: { current: HTMLElement | null } }
  event: Event
}): boolean {
  const activator = activeNode.activatorNode.current
  return Boolean(activator && event.target instanceof Node && activator.contains(event.target))
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
