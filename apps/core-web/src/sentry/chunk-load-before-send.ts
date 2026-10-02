import type { ErrorEvent, EventHint } from '@sentry/react'
import { isChunkLoadError } from '@/lib/chunk-load-recovery'

export function applyChunkLoadRecoveryBeforeSend(
  event: ErrorEvent,
  hint: EventHint,
): ErrorEvent | null {
  const original = hint.originalException
  if (!isChunkLoadError(original)) {
    return event
  }

  if (event.tags?.chunk_load_recovered === 'true') {
    return event
  }

  return {
    ...event,
    tags: {
      ...event.tags,
      chunk_load_recovered: 'true',
    },
    fingerprint: ['chunk-load-recovered', 'client'],
  }
}
