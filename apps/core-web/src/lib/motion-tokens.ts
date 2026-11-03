/**
 * Shared motion tokens (ADR-0036 R6).
 *
 * Finite interaction transitions are capped at 200 ms: 150 ms for ordinary UI,
 * 200 ms for sheets/dialogs. Repeating functional indicators and non-motion
 * timings are classified separately and are exempt from the cap. The duration
 * lint (AUT-893) resolves these exports instead of hardcoded literals.
 */

export type MotionKind = 'finite-transition' | 'repeating' | 'non-motion-timing'

export type MotionTokenName =
  | 'spinner'
  | 'skeletonPulse'
  | 'saveDebounce'
  | 'skeletonDelay'
  | 'refreshIndicatorDelay'
  | 'toastLifetime'
  | 'requestTimeout'

/** Finite interaction-transition durations in milliseconds. */
export const motionDurationMs = {
  ui: 150,
  overlay: 200,
} as const

/**
 * Tailwind duration class names carrying the token values. Tailwind only emits
 * classes it finds as complete literals in scanned source, and the duration lint
 * (AUT-893) resolves them statically, so these must never be built by interpolation.
 */
export const motionDurationClass = {
  ui: 'duration-150',
  overlay: 'duration-200',
} as const

const motionKindByName: Record<MotionTokenName, MotionKind> = {
  spinner: 'repeating',
  skeletonPulse: 'repeating',
  saveDebounce: 'non-motion-timing',
  skeletonDelay: 'non-motion-timing',
  refreshIndicatorDelay: 'non-motion-timing',
  toastLifetime: 'non-motion-timing',
  requestTimeout: 'non-motion-timing',
}

/** Classifies a motion/timing token so the 200 ms finite cap is only applied to finite transitions. */
export function motionKindOf(name: MotionTokenName): MotionKind {
  return motionKindByName[name]
}
