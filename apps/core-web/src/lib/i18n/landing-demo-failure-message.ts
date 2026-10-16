import type { TFunction } from 'i18next'
import type { LandingDemoFailureReason } from '@/auth/resolveLandingDemoCompletionFailure'

export function translateLandingDemoFailureReason(
  t: TFunction<'common'>,
  reason: LandingDemoFailureReason,
): string {
  return t(`landingDemo.errors.${reason}`)
}
