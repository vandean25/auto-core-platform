import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import {
  useUpdateVoiceTranslationSettings,
  useVoiceTranslationSettings,
} from '@/api/voice-translation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TARGET_LANGUAGE_OPTIONS } from '@/constants/voice-languages'
import { getErrorMessage } from '@/lib/error-utils'

type FormState = {
  targetLanguageCode: string
  googleProjectId: string
  googleLocation: string
  googleServiceAccountJson: string
}

const defaultFormState: FormState = {
  targetLanguageCode: 'de',
  googleProjectId: '',
  googleLocation: 'global',
  googleServiceAccountJson: '',
}

export function VoiceTranslationSettingsTab() {
  const { data, isLoading } = useVoiceTranslationSettings()
  const updateMutation = useUpdateVoiceTranslationSettings()
  const [formState, setFormState] = React.useState<FormState>(defaultFormState)

  React.useEffect(() => {
    if (!data) return
    setFormState((previous) => ({
      ...previous,
      targetLanguageCode: data.targetLanguageCode,
      googleProjectId: data.googleProjectId ?? '',
      googleLocation: data.googleLocation,
      googleServiceAccountJson: '',
    }))
  }, [data])

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault()
    try {
      await updateMutation.mutateAsync({
        targetLanguageCode: formState.targetLanguageCode,
        googleProjectId: formState.googleProjectId || null,
        googleLocation: formState.googleLocation,
        ...(formState.googleServiceAccountJson.trim()
          ? { googleServiceAccountJson: formState.googleServiceAccountJson.trim() }
          : {}),
      })
      setFormState((previous) => ({ ...previous, googleServiceAccountJson: '' }))
      toast.success('Voice translation settings saved')
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to save voice translation settings'))
    }
  }

  if (isLoading) {
    return (
      <div className='flex items-center justify-center py-12 text-slate-500'>
        <Loader2 className='mr-2 h-5 w-5 animate-spin' />
        Loading voice translation settings...
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Voice Translation</CardTitle>
        <CardDescription>
          Configure Google speech-to-text and translated output language for mechanic voice notes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className='space-y-4'>
          <div className='grid gap-2'>
            <Label htmlFor='voice-target-language'>Target Language</Label>
            <Select
              value={formState.targetLanguageCode}
              onValueChange={(value) =>
                setFormState((previous) => ({ ...previous, targetLanguageCode: value }))
              }
            >
              <SelectTrigger id='voice-target-language' className='w-full max-w-md'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TARGET_LANGUAGE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className='grid gap-2 max-w-md'>
            <Label htmlFor='voice-google-project'>Google Project ID</Label>
            <Input
              id='voice-google-project'
              value={formState.googleProjectId}
              onChange={(event) =>
                setFormState((previous) => ({ ...previous, googleProjectId: event.target.value }))
              }
              placeholder='my-google-project-id'
            />
          </div>

          <div className='grid gap-2 max-w-md'>
            <Label htmlFor='voice-google-location'>Google Location</Label>
            <Input
              id='voice-google-location'
              value={formState.googleLocation}
              onChange={(event) =>
                setFormState((previous) => ({ ...previous, googleLocation: event.target.value }))
              }
              placeholder='global'
            />
          </div>

          <div className='grid gap-2'>
            <Label htmlFor='voice-google-credential'>
              Google Service Account JSON
            </Label>
            <textarea
              id='voice-google-credential'
              className='min-h-[160px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
              value={formState.googleServiceAccountJson}
              onChange={(event) =>
                setFormState((previous) => ({
                  ...previous,
                  googleServiceAccountJson: event.target.value,
                }))
              }
              placeholder='{"type":"service_account",...}'
            />
            <p className='text-sm text-slate-500'>
              Credential is stored encrypted on the server and never returned to the browser.
              Current status: {data?.hasGoogleCredential ? 'configured' : 'not configured'}.
            </p>
          </div>

          <div className='flex justify-end'>
            <Button type='submit' disabled={updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

