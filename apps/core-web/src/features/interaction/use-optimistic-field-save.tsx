import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { InteractionErrorMarker } from '@/components/data-table/data-table-states'
import { getPermissionAwareErrorMessage } from '@/lib/error-utils'

type FieldFailure<TField extends string, TValue> = { field: TField; value: TValue }

type Options<TField extends string, TValue> = {
  /** Sends one field edit (`mutateAsync`). */
  save: (field: TField, value: TValue) => Promise<unknown>
  /** True when the cache shows the new value before the server answers; the editor then closes at once. */
  isOptimistic: (field: TField, value: TValue) => boolean
  successMessage: string
  failureMessage: string
  /** Toast text of a failed save; by default only a 403 gets the permission copy and the rest the fallback. */
  describeError?: (error: unknown, fallback: string) => string
}

/**
 * Inline field saves for ADR-0036 R1. An optimistic edit returns immediately; a rejection (the helper has already
 * restored the old value) keeps a visible marker with Retry and Dismiss until the user acts. A server-confirmed edit
 * is awaited and rethrown, so the editor stays open as before.
 */
export function useOptimisticFieldSave<TField extends string, TValue = string>({
  save,
  isOptimistic,
  successMessage,
  failureMessage,
  describeError = getPermissionAwareErrorMessage,
}: Options<TField, TValue>) {
  const [failures, setFailures] = useState<FieldFailure<TField, TValue>[]>([])

  const clear = useCallback((field: TField) => {
    setFailures((current) => current.filter((failure) => failure.field !== field))
  }, [])

  const saveField = useCallback(
    async (field: TField, value: TValue) => {
      clear(field)
      const request = save(field, value)
      const reportFailure = (error: unknown) => toast.error(describeError(error, failureMessage))
      if (!isOptimistic(field, value)) {
        try {
          await request
          toast.success(successMessage)
        } catch (error) {
          reportFailure(error)
          throw error
        }
        return
      }
      void request.then(
        () => toast.success(successMessage),
        (error: unknown) => {
          setFailures((current) => [...current.filter((failure) => failure.field !== field), { field, value }])
          reportFailure(error)
        },
      )
    },
    [clear, describeError, failureMessage, isOptimistic, save, successMessage],
  )

  const retry = useCallback(
    (failure: FieldFailure<TField, TValue>) => void saveField(failure.field, failure.value),
    [saveField],
  )

  return { saveField, failures, retry, dismiss: clear }
}

type FailuresProps<TField extends string, TValue> = {
  failures: FieldFailure<TField, TValue>[]
  /** Names the record and field, e.g. "Telefon wurde nicht gespeichert". */
  message: (field: TField) => string
  onRetry: (failure: FieldFailure<TField, TValue>) => void
  onDismiss: (field: TField) => void
}

export function FieldSaveFailures<TField extends string, TValue>({
  failures,
  message,
  onRetry,
  onDismiss,
}: FailuresProps<TField, TValue>) {
  return failures.map((failure) => (
    <InteractionErrorMarker
      key={failure.field}
      message={message(failure.field)}
      onRetry={() => onRetry(failure)}
      onDismiss={() => onDismiss(failure.field)}
    />
  ))
}
