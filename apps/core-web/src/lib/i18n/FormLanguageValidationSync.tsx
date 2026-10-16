import { useEffect } from 'react'
import { useFormContext } from 'react-hook-form'
import { registerFormValidationRefresh } from './form-validation-refresh'

/** Re-runs react-hook-form validation when the UI language changes (Zod locale updates). */
export function FormLanguageValidationSync() {
  const { trigger } = useFormContext()

  useEffect(() => {
    return registerFormValidationRefresh(async () => {
      await trigger(undefined, { shouldFocus: false })
    })
  }, [trigger])

  return null
}
