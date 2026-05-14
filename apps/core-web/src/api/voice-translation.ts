import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchWithAuth } from './client'

export type VoiceTranslationSettings = {
  id: string
  targetLanguageCode: string
  googleProjectId?: string | null
  googleLocation: string
  hasGoogleCredential: boolean
  updatedAt: string
}

export type UpdateVoiceTranslationSettingsPayload = {
  targetLanguageCode?: string
  googleProjectId?: string | null
  googleLocation?: string
  googleServiceAccountJson?: string | null
}

export const voiceTranslationKeys = {
  all: ['voice-translation'] as const,
  settings: () => [...voiceTranslationKeys.all, 'settings'] as const,
}

async function readErrorMessage(response: Response, fallback: string) {
  const payload = await response.json().catch(() => undefined) as
    | { message?: string }
    | undefined
  return payload?.message || fallback
}

export function useVoiceTranslationSettings() {
  return useQuery<VoiceTranslationSettings>({
    queryKey: voiceTranslationKeys.settings(),
    queryFn: async () => {
      const response = await fetchWithAuth('/api/voice-translation/settings')
      if (!response.ok) {
        throw new Error(
          await readErrorMessage(
            response,
            'Failed to fetch voice translation settings',
          ),
        )
      }
      return response.json()
    },
  })
}

export function useUpdateVoiceTranslationSettings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: UpdateVoiceTranslationSettingsPayload) => {
      const response = await fetchWithAuth('/api/voice-translation/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        throw new Error(
          await readErrorMessage(
            response,
            'Failed to update voice translation settings',
          ),
        )
      }
      return response.json() as Promise<VoiceTranslationSettings>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: voiceTranslationKeys.settings() })
    },
  })
}
