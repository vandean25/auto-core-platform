import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('settings')
  const { data, isLoading } = useVoiceTranslationSettings()
  const updateMutation = useUpdateVoiceTranslationSettings()
  const [formState, setFormState] = React.useState<FormState>(defaultFormState)
  const [showCredential, setShowCredential] = React.useState(false)

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
    const isOverwritingCredential =
      Boolean(data?.hasGoogleCredential) && Boolean(formState.googleServiceAccountJson.trim())
    if (
      isOverwritingCredential &&
      !window.confirm(t('voiceTranslation.overwriteConfirm'))
    ) {
      return
    }
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
      toast.success(t('voiceTranslation.toast.saved'))
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('voiceTranslation.toast.saveFailed')))
    }
  }

  if (isLoading) {
    return (
      <div className='flex items-center justify-center py-12 text-slate-500'>
        <Loader2 className='mr-2 h-5 w-5 animate-spin' />
        {t('voiceTranslation.loading')}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('voiceTranslation.title')}</CardTitle>
        <CardDescription>
          {t('voiceTranslation.description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className='space-y-4'>
          <div className='grid gap-2'>
            <Label htmlFor='voice-target-language'>{t('voiceTranslation.targetLanguage')}</Label>
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
            <Label htmlFor='voice-google-project'>{t('voiceTranslation.projectId')}</Label>
            <Input
              id='voice-google-project'
              value={formState.googleProjectId}
              onChange={(event) =>
                setFormState((previous) => ({ ...previous, googleProjectId: event.target.value }))
              }
              placeholder={t('voiceTranslation.projectIdPlaceholder')}
            />
          </div>

          <div className='grid gap-2 max-w-md'>
            <Label htmlFor='voice-google-location'>{t('voiceTranslation.location')}</Label>
            <Input
              id='voice-google-location'
              value={formState.googleLocation}
              onChange={(event) =>
                setFormState((previous) => ({ ...previous, googleLocation: event.target.value }))
              }
              placeholder={t('voiceTranslation.locationPlaceholder')}
            />
          </div>

          <div className='grid gap-2'>
            <Label htmlFor='voice-google-credential'>
              {t('voiceTranslation.credential')}
            </Label>
            <textarea
              id='voice-google-credential'
              className='min-h-[160px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono'
              value={
                showCredential
                  ? formState.googleServiceAccountJson
                  : formState.googleServiceAccountJson
                    ? '••••••••••••••••••••••••••••••••'
                    : ''
              }
              onChange={
                showCredential
                  ? (event) =>
                      setFormState((previous) => ({
                        ...previous,
                        googleServiceAccountJson: event.target.value,
                      }))
                  : undefined
              }
              readOnly={!showCredential}
              placeholder={t('voiceTranslation.credentialPlaceholder')}
            />
            <p className='text-sm text-slate-500'>
              {t('voiceTranslation.credentialHint', {
                status: data?.hasGoogleCredential
                  ? t('voiceTranslation.credentialConfigured')
                  : t('voiceTranslation.credentialNotConfigured'),
              })}
            </p>
            <label className='flex items-center gap-2 text-sm text-slate-600'>
              <input
                type='checkbox'
                checked={showCredential}
                onChange={(event) => setShowCredential(event.target.checked)}
              />
              {t('voiceTranslation.showCredential')}
            </label>
          </div>

          <div className='flex justify-end'>
            <Button type='submit' disabled={updateMutation.isPending}>
              {updateMutation.isPending ? t('voiceTranslation.saving') : t('voiceTranslation.save')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
