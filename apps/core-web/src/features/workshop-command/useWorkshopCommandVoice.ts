import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { transcribeWorkshopAudio } from '@/api/workshop-command'
import { toCommandError, voiceErrorMessage } from './command-error'
import { isCommandVoiceSupported, selectCommandRecorderMimeType } from './voice'

export type CommandVoiceState = 'idle' | 'recording' | 'transcribing'

function buildRecorder(
  stream: MediaStream,
  chunks: BlobPart[],
  onStop: (mimeType: string) => void,
): MediaRecorder {
  const mimeType = selectCommandRecorderMimeType()
  const recorder = mimeType
    ? new MediaRecorder(stream, { mimeType })
    : new MediaRecorder(stream)
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }
  recorder.onstop = () => onStop(recorder.mimeType)
  return recorder
}

/**
 * Recording is only the entry to the text path: the transcript lands in the
 * editable sentence, and a denied mic or a failing provider keeps typing.
 */
export function useWorkshopCommandVoice(
  onTranscript: (transcript: string) => void,
) {
  const { t } = useTranslation('workshop')
  const [state, setState] = React.useState<CommandVoiceState>('idle')
  const [error, setError] = React.useState<string | null>(null)
  const recorderRef = React.useRef<MediaRecorder | null>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const chunksRef = React.useRef<BlobPart[]>([])

  const supported = React.useMemo(() => isCommandVoiceSupported(), [])

  const stopStream = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  React.useEffect(() => stopStream, [stopStream])

  const transcribe = React.useCallback(
    (audio: Blob) => {
      setState('transcribing')
      void transcribeWorkshopAudio(audio)
        .then((result) => onTranscript(result.transcript))
        .catch((failure) => {
          setError(voiceErrorMessage(toCommandError(failure), t))
        })
        .finally(() => setState('idle'))
    },
    [onTranscript, t],
  )

  const handleStop = React.useCallback(
    (mimeType: string) => {
      stopStream()
      transcribe(new Blob(chunksRef.current, { type: mimeType || 'audio/webm' }))
    },
    [stopStream, transcribe],
  )

  const start = async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []
      recorderRef.current = buildRecorder(stream, chunksRef.current, handleStop)
      recorderRef.current.start()
      setState('recording')
    } catch {
      stopStream()
      setState('idle')
      setError(t('command.micDenied'))
    }
  }

  const stop = () => {
    const recorder = recorderRef.current
    if (recorder && recorder.state === 'recording') recorder.stop()
    recorderRef.current = null
  }

  const toggle = () => {
    if (state === 'recording') {
      stop()
      return
    }
    void start()
  }

  return { state, error, supported, toggle }
}
