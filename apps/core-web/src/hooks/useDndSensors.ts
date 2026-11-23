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

export function useDndSensors() {
  return useSensors(
    useSensor(MouseSensor, MOUSE_SENSOR_OPTIONS),
    useSensor(TouchSensor, TOUCH_SENSOR_OPTIONS),
    useSensor(KeyboardSensor),
  )
}
