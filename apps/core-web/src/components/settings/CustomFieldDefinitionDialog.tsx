import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  useCreateCustomFieldDefinition,
  useUpdateCustomFieldDefinition,
  type CustomFieldDefinition,
  type CustomFieldEntity,
  type CustomFieldType,
} from '@/api/custom-fields'
import { getErrorBody, getErrorMessage } from '@/lib/error-utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const FIELD_TYPES: readonly CustomFieldType[] = ['TEXT', 'NUMBER', 'DATE', 'SELECT', 'BOOLEAN']

type CustomFieldDefinitionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  entity: CustomFieldEntity
  editing: CustomFieldDefinition | null
}

export function CustomFieldDefinitionDialog({
  open,
  onOpenChange,
  entity,
  editing,
}: CustomFieldDefinitionDialogProps) {
  const { t } = useTranslation(['settings', 'common'])
  const createMutation = useCreateCustomFieldDefinition()
  const updateMutation = useUpdateCustomFieldDefinition()

  const [label, setLabel] = React.useState('')
  const [key, setKey] = React.useState('')
  const [type, setType] = React.useState<CustomFieldType>('TEXT')
  const [optionsText, setOptionsText] = React.useState('')
  const [purpose, setPurpose] = React.useState('')
  const [personalData, setPersonalData] = React.useState(true)
  const [needsArt9Confirm, setNeedsArt9Confirm] = React.useState(false)
  const [confirmNoArt9, setConfirmNoArt9] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    if (editing) {
      setLabel(editing.label)
      setKey(editing.key)
      setType(editing.type)
      setOptionsText((editing.options ?? []).join('\n'))
      setPurpose(editing.purpose)
      setPersonalData(editing.personal_data)
    } else {
      setLabel('')
      setKey('')
      setType('TEXT')
      setOptionsText('')
      setPurpose('')
      setPersonalData(true)
    }
    setNeedsArt9Confirm(false)
    setConfirmNoArt9(false)
    setErrorMessage(null)
  }, [open, editing])

  const isPending = createMutation.isPending || updateMutation.isPending

  const parseOptions = () =>
    optionsText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setErrorMessage(null)

    try {
      if (editing) {
        await updateMutation.mutateAsync({
          id: editing.id,
          data: {
            label: label.trim(),
            purpose: purpose.trim(),
            personal_data: personalData,
            ...(editing.type === 'SELECT' ? { options: parseOptions() } : {}),
            ...(confirmNoArt9 ? { confirmNoArt9: true } : {}),
          },
        })
        toast.success(t('settings:customFields.dialog.updated'))
      } else {
        await createMutation.mutateAsync({
          entity,
          label: label.trim(),
          ...(key.trim() ? { key: key.trim() } : {}),
          type,
          ...(type === 'SELECT' ? { options: parseOptions() } : {}),
          purpose: purpose.trim(),
          personal_data: personalData,
          retention_class: 'PARENT_OBJECT',
          ...(confirmNoArt9 ? { confirmNoArt9: true } : {}),
        })
        toast.success(t('settings:customFields.dialog.created'))
      }
      onOpenChange(false)
    } catch (error: unknown) {
      const body = getErrorBody(error)
      if (body?.code === 'CUSTOM_FIELD_ART9_CONFIRMATION_REQUIRED') {
        setNeedsArt9Confirm(true)
      }
      setErrorMessage(getErrorMessage(error, t('settings:customFields.saveFailed')))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing
              ? t('settings:customFields.dialog.editTitle')
              : t('settings:customFields.dialog.createTitle')}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cf-label">{t('settings:customFields.dialog.label')}</Label>
            <Input
              id="cf-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={60}
              required
              placeholder={t('settings:customFields.dialog.labelPlaceholder')}
            />
          </div>

          {!editing && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="cf-key">{t('settings:customFields.dialog.key')}</Label>
                <Input
                  id="cf-key"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  maxLength={64}
                  placeholder={t('settings:customFields.dialog.keyPlaceholder')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cf-type">{t('settings:customFields.dialog.type')}</Label>
                <Select value={type} onValueChange={(v) => setType(v as CustomFieldType)}>
                  <SelectTrigger id="cf-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIELD_TYPES.map((ft) => (
                      <SelectItem key={ft} value={ft}>
                        {t(`settings:customFields.types.${ft}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {type === 'SELECT' && (
            <div className="space-y-1.5">
              <Label htmlFor="cf-options">{t('settings:customFields.dialog.options')}</Label>
              <textarea
                id="cf-options"
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                rows={4}
                required
                placeholder={t('settings:customFields.dialog.optionsPlaceholder')}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="cf-purpose">{t('settings:customFields.dialog.purpose')}</Label>
            <textarea
              id="cf-purpose"
              className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              maxLength={500}
              rows={2}
              required
              placeholder={t('settings:customFields.dialog.purposePlaceholder')}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="cf-personal-data"
                checked={personalData}
                onCheckedChange={(checked) => setPersonalData(checked === true)}
              />
              <Label htmlFor="cf-personal-data" className="font-normal">
                {t('settings:customFields.dialog.personalData')}
              </Label>
            </div>
            {entity === 'VEHICLE' && !personalData && (
              <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-muted/50 p-2.5 text-xs text-foreground">
                <AlertTriangle className="h-4 w-4 shrink-0 text-warning mt-0.5" />
                <span>{t('settings:customFields.dialog.vehiclePersonalReviewHint')}</span>
              </div>
            )}
          </div>

          {needsArt9Confirm && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-muted/50 p-3">
              <Checkbox
                id="cf-art9-confirm"
                checked={confirmNoArt9}
                onCheckedChange={(checked) => setConfirmNoArt9(checked === true)}
              />
              <Label htmlFor="cf-art9-confirm" className="text-xs font-normal leading-snug">
                {t('settings:customFields.dialog.art9Confirm')}
              </Label>
            </div>
          )}

          {errorMessage && (
            <p className="text-sm text-destructive" role="alert">
              {errorMessage}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isPending ? t('common:documentSave.saving') : t('common:actions.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
