import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  useCreateMediaUploadPolicy,
  useSaveMediaMetadata,
} from '@/api/mechanic'
import type { RequestMediaUploadPayload } from '@/api/mechanic'
import { getErrorMessage } from '@/lib/error-utils'
import { ALLOWED_MEDIA_TYPES, MEDIA_UPLOAD_DONE_RESET_MS } from '../constants'
import type { UploadState } from '../types'

export function useMediaUpload(taskId: string) {
  const createUploadPolicy = useCreateMediaUploadPolicy()
  const saveMediaMeta = useSaveMediaMetadata()
  const [uploadState, setUploadState] = useState<UploadState>('idle')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadDoneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (uploadDoneTimerRef.current !== null) {
        clearTimeout(uploadDoneTimerRef.current)
      }
    }
  }, [])

  const handleFileSelected = async (file: File) => {
    if (!ALLOWED_MEDIA_TYPES.has(file.type)) {
      toast.error('Unsupported file type. Use JPEG, PNG, WebP, MP4, or MOV.')
      return
    }
    setUploadState('uploading')
    try {
      const mimeType = file.type as RequestMediaUploadPayload['mimeType']
      const policy = await createUploadPolicy.mutateAsync({
        taskId,
        payload: { mimeType, sizeBytes: file.size, filename: file.name },
      })

      const formData = new FormData()
      for (const [key, value] of Object.entries(policy.formFields)) {
        formData.append(key, value)
      }
      formData.append('file', file)
      const uploadRes = await fetch(policy.uploadUrl, { method: 'POST', body: formData })
      if (!uploadRes.ok) {
        throw new Error(
          `Upload to storage failed: ${uploadRes.status.toString()} ${uploadRes.statusText}`,
        )
      }

      await saveMediaMeta.mutateAsync({
        taskId,
        payload: {
          storageKey: policy.storageKey,
          storageBucket: policy.storageBucket,
          mimeType,
          sizeBytes: file.size,
        },
      })

      setUploadState('done')
      toast.success('Media uploaded successfully')
      if (uploadDoneTimerRef.current !== null) {
        clearTimeout(uploadDoneTimerRef.current)
      }
      uploadDoneTimerRef.current = setTimeout(() => {
        setUploadState('idle')
        uploadDoneTimerRef.current = null
      }, MEDIA_UPLOAD_DONE_RESET_MS)
    } catch (error: unknown) {
      setUploadState('error')
      toast.error(getErrorMessage(error, 'Upload failed'))
    }
  }

  return {
    uploadState,
    setUploadState,
    fileInputRef,
    handleFileSelected,
  }
}
