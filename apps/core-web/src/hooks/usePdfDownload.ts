import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { generateAndDownloadPdfBlob } from '@/lib/async-pdf'
import { triggerBlobDownload } from '@/lib/download'
import { getErrorMessage, isAbortError } from '@/lib/error-utils'

export interface UsePdfDownloadMessages {
  preparing?: string
  generating?: string
  success?: string
  errorFallback?: string
  timeout?: string
}

export interface UsePdfDownloadConfig {
  postUrl: string | (() => string)
  getUrl: string | (() => string)
  filename: string | (() => string)
  checkGenerationFailed?: () => Promise<string | null>
  timeoutMs?: number
  intervalMs?: number
  backoffMultiplier?: number
  maxIntervalMs?: number
  messages?: UsePdfDownloadMessages
  onSuccess?: (blob: Blob) => void
  onError?: (error: unknown) => void
}

export interface UsePdfDownloadResult {
  download: (overrideConfig?: Partial<UsePdfDownloadConfig>) => Promise<boolean>
  isLoading: boolean
  isDownloading: boolean
}

export function usePdfDownload(config?: Partial<UsePdfDownloadConfig>): UsePdfDownloadResult {
  const [isLoading, setIsLoading] = useState(false)
  const inFlightRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const isMountedRef = useRef(true)
  const configRef = useRef(config)

  useEffect(() => {
    configRef.current = config
  })

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      abortControllerRef.current?.abort()
    }
  }, [])

  const download = useCallback(
    async (overrideConfig?: Partial<UsePdfDownloadConfig>): Promise<boolean> => {
      if (inFlightRef.current) {
        return false
      }

      inFlightRef.current = true
      setIsLoading(true)

      const baseConfig = configRef.current
      const mergedMessages: UsePdfDownloadMessages = {
        ...baseConfig?.messages,
        ...overrideConfig?.messages,
      }

      const postUrl = overrideConfig?.postUrl ?? baseConfig?.postUrl
      const getUrl = overrideConfig?.getUrl ?? baseConfig?.getUrl
      const filename = overrideConfig?.filename ?? baseConfig?.filename

      const resolvedPostUrl = typeof postUrl === 'function' ? postUrl() : postUrl
      const resolvedGetUrl = typeof getUrl === 'function' ? getUrl() : getUrl
      const resolvedFilename = typeof filename === 'function' ? filename() : filename

      const checkGenerationFailed =
        overrideConfig?.checkGenerationFailed ?? baseConfig?.checkGenerationFailed
      const timeoutMs = overrideConfig?.timeoutMs ?? baseConfig?.timeoutMs
      const intervalMs = overrideConfig?.intervalMs ?? baseConfig?.intervalMs
      const backoffMultiplier =
        overrideConfig?.backoffMultiplier ?? baseConfig?.backoffMultiplier
      const maxIntervalMs = overrideConfig?.maxIntervalMs ?? baseConfig?.maxIntervalMs
      const onSuccess = overrideConfig?.onSuccess ?? baseConfig?.onSuccess
      const onError = overrideConfig?.onError ?? baseConfig?.onError

      const abortController = new AbortController()
      abortControllerRef.current = abortController

      const toastId = toast.loading(
        mergedMessages.preparing ?? 'Preparing PDF, this may take a few seconds...',
      )

      try {
        if (!resolvedPostUrl || !resolvedGetUrl) {
          throw new Error('PDF postUrl and getUrl are required')
        }

        const blob = await generateAndDownloadPdfBlob({
          postUrl: resolvedPostUrl,
          getUrl: resolvedGetUrl,
          signal: abortController.signal,
          intervalMs,
          maxIntervalMs,
          backoffMultiplier,
          timeoutMs,
          timeoutErrorMessage: mergedMessages.timeout,
          errorFallbackMessage:
            mergedMessages.errorFallback ?? 'PDF-Erstellung fehlgeschlagen',
          checkGenerationFailed,
          onPoll: (attempt) => {
            if (attempt === 1) {
              toast.loading(
                mergedMessages.generating ?? 'Generating PDF in the background...',
                { id: toastId },
              )
            }
          },
        })

        const finalFilename = resolvedFilename || 'document.pdf'
        triggerBlobDownload(blob, finalFilename)

        toast.success(mergedMessages.success ?? 'PDF downloaded successfully', {
          id: toastId,
        })

        onSuccess?.(blob)
        return true
      } catch (error: unknown) {
        if (
          isAbortError(error) ||
          abortController.signal.aborted ||
          !isMountedRef.current
        ) {
          toast.dismiss(toastId)
          return false
        }

        toast.error(
          getErrorMessage(
            error,
            mergedMessages.errorFallback ?? 'PDF-Erstellung fehlgeschlagen',
          ),
          { id: toastId },
        )
        onError?.(error)
        return false
      } finally {
        inFlightRef.current = false
        if (isMountedRef.current) {
          setIsLoading(false)
        }
      }
    },
    [],
  )

  return {
    download,
    isLoading,
    isDownloading: isLoading,
  }
}
