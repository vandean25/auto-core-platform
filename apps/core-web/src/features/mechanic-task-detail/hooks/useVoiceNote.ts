import { useCallback, useEffect, useRef, useState } from 'react'
import { useUploadVoiceNote } from '@/api/mechanic'
import { getErrorMessage } from '@/lib/error-utils'
import { mergeVoiceDraftIntoNotes } from '../notes'
import type { VoiceNoteState } from '../types'
import { isVoiceNoteSupported, selectVoiceRecorderMimeType } from '../voice-recorder'

type UseVoiceNoteOptions = {
  taskId: string
  notesValue: string
  onAcceptDraft: (mergedNotes: string) => void
}

export function useVoiceNote({ taskId, notesValue, onAcceptDraft }: UseVoiceNoteOptions) {
  const uploadVoiceNote = useUploadVoiceNote()
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
        setVoiceNoteError('Voice note failed. Please retry recording.')
      }
      recorder.onstop = () => {
        stopMediaCapture()
        const chunks = voiceChunksRef.current
        voiceChunksRef.current = []
        if (chunks.length === 0) {
          setVoiceNoteState('error')
          setVoiceNoteError('No audio captured. Please retry recording.')
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
            setVoiceNoteError(getErrorMessage(error, 'Voice note failed. Please retry recording.'))
          })
      }
      recorder.start()
      setVoiceNoteState('recording')
    } catch (error: unknown) {
      stopMediaCapture()
      setVoiceNoteState('error')
      setVoiceNoteError(getErrorMessage(error, 'Unable to access microphone.'))
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
