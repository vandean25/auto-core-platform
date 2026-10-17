import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUploadVoiceNote } from '@/api/mechanic'
import { getErrorMessage } from '@/lib/error-utils'
import { mergeVoiceDraftIntoNotes } from '../notes'
import type { VoiceNoteState } from '../types'
import { isVoiceNoteSupported, selectVoiceRecorderMimeType } from '../voice-recorder'

const MICROPHONE_ACCESS_ERROR_NAMES = new Set([
  'NotFoundError',
  'DevicesNotFoundError',
  'OverconstrainedError',
  'NotAllowedError',
  'PermissionDeniedError',
])

type UseVoiceNoteOptions = {
  taskId: string
  notesValue: string
  onAcceptDraft: (mergedNotes: string) => void
}

export function useVoiceNote({ taskId, notesValue, onAcceptDraft }: UseVoiceNoteOptions) {
  const { t } = useTranslation('workshop')
  const uploadVoiceNote = useUploadVoiceNote()

  const getMicrophoneAccessErrorMessage = useCallback(
    (error: unknown): string => {
      const errorName =
        typeof error === 'object' && error !== null && 'name' in error
          ? String(error.name)
          : ''

      if (MICROPHONE_ACCESS_ERROR_NAMES.has(errorName)) {
        return t('mechanic.taskDetail.voiceNote.noMicrophone')
      }

      return t('mechanic.taskDetail.voiceNote.microphoneAccessFailed')
    },
    [t],
  )
  const voiceSupported = isVoiceNoteSupported()
  const [voiceNoteState, setVoiceNoteState] = useState<VoiceNoteState>(
    voiceSupported ? 'idle' : 'unsupported',
  )
  const [voiceDraftValue, setVoiceDraftValue] = useState('')
  const [voiceNoteError, setVoiceNoteError] = useState('')
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const voiceChunksRef = useRef<BlobPart[]>([])
  const voiceStartInFlightRef = useRef(false)

  const stopMediaCapture = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (recorder) {
      recorder.ondataavailable = null
      recorder.onstop = null
      recorder.onerror = null
      if (recorder.state === 'recording') {
        try {
          recorder.stop()
        } catch {
          // Recorder may already be stopping or closed.
        }
      }
    }

    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop()
      }
      mediaStreamRef.current = null
    }
    mediaRecorderRef.current = null
    voiceStartInFlightRef.current = false
  }, [])

  useEffect(() => {
    setVoiceNoteState(voiceSupported ? 'idle' : 'unsupported')
    setVoiceDraftValue('')
    setVoiceNoteError('')
    voiceChunksRef.current = []
    stopMediaCapture()
  }, [stopMediaCapture, taskId, voiceSupported])

  useEffect(() => {
    return () => {
      stopMediaCapture()
    }
  }, [stopMediaCapture])

  const startVoiceNoteRecording = async () => {
    if (voiceStartInFlightRef.current) return
    if (!voiceSupported) {
      setVoiceNoteState('unsupported')
      return
    }

    voiceStartInFlightRef.current = true
    setVoiceNoteState('processing')
    setVoiceNoteError('')
    setVoiceDraftValue('')
    voiceChunksRef.current = []

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream

      const recorderMimeType = selectVoiceRecorderMimeType()
      const recorder = recorderMimeType
        ? new MediaRecorder(stream, { mimeType: recorderMimeType })
        : new MediaRecorder(stream)
      mediaRecorderRef.current = recorder
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          voiceChunksRef.current.push(event.data)
        }
      }
      recorder.onerror = () => {
        stopMediaCapture()
        setVoiceNoteState('error')
        setVoiceNoteError(t('mechanic.taskDetail.voiceNote.errorFallback'))
      }
      recorder.onstop = () => {
        stopMediaCapture()
        const chunks = voiceChunksRef.current
        voiceChunksRef.current = []
        if (chunks.length === 0) {
          setVoiceNoteState('error')
          setVoiceNoteError(t('mechanic.taskDetail.voiceNote.noAudioCaptured'))
          return
        }

        const audioMimeType = recorder.mimeType || recorderMimeType || 'audio/webm'
        const audioBlob = new Blob(chunks, { type: audioMimeType })
        setVoiceNoteState('processing')
        void uploadVoiceNote
          .mutateAsync({ taskId, audio: audioBlob })
          .then((draft) => {
            setVoiceDraftValue(draft.text)
            setVoiceNoteError('')
            setVoiceNoteState('draft-ready')
          })
          .catch((error: unknown) => {
            console.error('[MechanicTaskDetail] Voice-note upload failed:', error)
            setVoiceNoteState('error')
            setVoiceNoteError(
              getErrorMessage(error, t('mechanic.taskDetail.voiceNote.errorFallback')),
            )
          })
      }
      recorder.start()
      setVoiceNoteState('recording')
    } catch (error: unknown) {
      stopMediaCapture()
      setVoiceNoteState('error')
      setVoiceNoteError(getMicrophoneAccessErrorMessage(error))
    } finally {
      voiceStartInFlightRef.current = false
    }
  }

  const stopVoiceNoteRecording = () => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    recorder.stop()
  }

  const handleAcceptVoiceDraft = () => {
    const draft = voiceDraftValue.trim()
    if (!draft) {
      setVoiceDraftValue('')
      setVoiceNoteState('idle')
      return
    }
    onAcceptDraft(mergeVoiceDraftIntoNotes(notesValue, draft))
    setVoiceDraftValue('')
    setVoiceNoteError('')
    setVoiceNoteState('accepted')
  }

  const handleDiscardVoiceDraft = () => {
    setVoiceDraftValue('')
    setVoiceNoteError('')
    setVoiceNoteState('idle')
  }

  return {
    voiceNoteState,
    voiceDraftValue,
    voiceNoteError,
    setVoiceDraftValue,
    startVoiceNoteRecording,
    stopVoiceNoteRecording,
    handleAcceptVoiceDraft,
    handleDiscardVoiceDraft,
  }
}
