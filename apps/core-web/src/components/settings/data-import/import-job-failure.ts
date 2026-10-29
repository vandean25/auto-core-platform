import { i18n } from '@/lib/i18n'

import type { ImportJob } from '@/api/imports'

/** The stable error code the apply run recorded for a failed job, when one is present. */
export function importJobFailureCode(job: ImportJob): string | null {
  const code = (job.options as Record<string, unknown> | null | undefined)?.[
    'apply_failure_code'
  ]
  return typeof code === 'string' && code.length > 0 ? code : null
}

/** Localized reason of a failed job from the error catalog; an unknown code gets the fallback sentence. */
export function translateImportJobFailure(
  job: ImportJob,
  fallbackMessage: string,
): string {
  const code = importJobFailureCode(job)
  if (code) {
    const known = i18n.t(`errors:codes.${code}`, { defaultValue: '' })
    if (known) {
      return known
    }
  }
  return fallbackMessage
}
