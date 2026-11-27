import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Loader2 } from 'lucide-react'

import { useAuthSession } from '@/api/auth-session'
import {
  useCreateCustomFieldDefinition,
  useCustomFieldDefinitions,
  type CustomFieldEntity,
  type CustomFieldType,
} from '@/api/custom-fields'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getErrorBody, getErrorMessage } from '@/lib/error-utils'

const CUSTOM_FIELD_MAPPING_PREFIX = 'custom_fields.'
const FIELD_TYPES: readonly CustomFieldType[] = ['TEXT', 'NUMBER', 'DATE', 'SELECT', 'BOOLEAN']

export type DataImportCustomFieldsSectionProps = {
  entityType: CustomFieldEntity
  unmappedHeaders: string[]
  mapping: Record<string, string>
  onMappingChange: (fieldKey: string, csvColumn: string) => void
}

function findMappedCustomFieldKey(mapping: Record<string, string>, csvColumn: string): string {
  for (const [key, value] of Object.entries(mapping)) {
    if (key.startsWith(CUSTOM_FIELD_MAPPING_PREFIX) && value === csvColumn) {
      return key.slice(CUSTOM_FIELD_MAPPING_PREFIX.length)
    }
  }
  return ''
}

type InlineCreateState = {
  csvColumn: string
  label: string
  type: CustomFieldType
  optionsText: string
  purpose: string
  needsArt9Confirm: boolean
  confirmNoArt9: boolean
  errorMessage: string | null
}

function parseSelectOptions(type: CustomFieldType, optionsText: string): string[] | undefined {
  if (type !== 'SELECT') return undefined
  return optionsText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

type InlineCustomFieldCreateFormProps = {
  state: InlineCreateState
  isPending: boolean
  onChange: (next: InlineCreateState) => void
  onSubmit: (event: React.FormEvent) => void
  onCancel: () => void
}

function InlineCustomFieldCreateForm({
  state,
  isPending,
  onChange,
  onSubmit,
  onCancel,
}: InlineCustomFieldCreateFormProps) {
  const { t } = useTranslation(['settings', 'common'])

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-md border border-border bg-muted/50 p-3">
      <p className="text-xs font-medium">
        {t('dataImport.mapping.customFields.createTitle', { column: state.csvColumn })}
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="import-cf-label">{t('dataImport.mapping.customFields.label')}</Label>
          <Input
            id="import-cf-label"
            value={state.label}
            onChange={(e) => onChange({ ...state, label: e.target.value })}
            maxLength={60}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="import-cf-type">{t('dataImport.mapping.customFields.type')}</Label>
          <Select
            value={state.type}
            onValueChange={(value) => onChange({ ...state, type: value as CustomFieldType })}
          >
            <SelectTrigger id="import-cf-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FIELD_TYPES.map((ft) => (
                <SelectItem key={ft} value={ft}>
                  {t(`customFields.types.${ft}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {state.type === 'SELECT' ? (
        <div className="space-y-1.5">
          <Label htmlFor="import-cf-options">{t('dataImport.mapping.customFields.options')}</Label>
          <textarea
            id="import-cf-options"
            className="flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={state.optionsText}
            onChange={(e) => onChange({ ...state, optionsText: e.target.value })}
            rows={3}
          />
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="import-cf-purpose">{t('dataImport.mapping.customFields.purpose')}</Label>
        <Input
          id="import-cf-purpose"
          value={state.purpose}
          onChange={(e) => onChange({ ...state, purpose: e.target.value })}
          maxLength={500}
        />
      </div>

      {state.needsArt9Confirm ? (
        <div className="flex items-start gap-2 rounded-md border border-border bg-background p-2.5 text-xs">
          <Checkbox
            id="import-cf-art9-confirm"
            checked={state.confirmNoArt9}
            onCheckedChange={(checked) => onChange({ ...state, confirmNoArt9: checked === true })}
          />
          <Label htmlFor="import-cf-art9-confirm" className="cursor-pointer font-normal leading-snug">
            {t('dataImport.mapping.customFields.art9Confirm')}
          </Label>
        </div>
      ) : null}

      {state.errorMessage ? (
        <div role="alert" className="flex items-start gap-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{state.errorMessage}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
          {t('dataImport.mapping.customFields.createAction')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          {t('common:actions.cancel')}
        </Button>
      </div>
    </form>
  )
}

/**
 * Allows OWNER/ADMIN to map unmapped CSV columns to existing or newly created custom fields
 * when the tenant's custom_fields feature flag is enabled.
 */
export function DataImportCustomFieldsSection(props: DataImportCustomFieldsSectionProps) {
  const { t } = useTranslation(['settings', 'common'])
  const { data: session } = useAuthSession()
  const customFieldsEnabled = Boolean(session?.customFieldsEnabled)
  const isAdmin = session?.activeRole === 'OWNER' || session?.activeRole === 'ADMIN'
  const isVisible = customFieldsEnabled && isAdmin && props.unmappedHeaders.length > 0

  const definitionsQuery = useCustomFieldDefinitions(props.entityType, { enabled: isVisible })
  const createMutation = useCreateCustomFieldDefinition()
  const [inlineCreate, setInlineCreate] = React.useState<InlineCreateState | null>(null)

  if (!isVisible) {
    return null
  }

  const definitions = definitionsQuery.data ?? []

  const clearPreviousMapping = (csvColumn: string, keepKey?: string) => {
    const previousKey = findMappedCustomFieldKey(props.mapping, csvColumn)
    if (previousKey && previousKey !== keepKey) {
      props.onMappingChange(`${CUSTOM_FIELD_MAPPING_PREFIX}${previousKey}`, '')
    }
  }

  const handleSelectChange = (csvColumn: string, value: string) => {
    if (value === '__create__') {
      setInlineCreate({
        csvColumn,
        label: csvColumn,
        type: 'TEXT',
        optionsText: '',
        purpose: '',
        needsArt9Confirm: false,
        confirmNoArt9: false,
        errorMessage: null,
      })
      return
    }
    if (inlineCreate?.csvColumn === csvColumn) {
      setInlineCreate(null)
    }
    clearPreviousMapping(csvColumn, value)
    if (value !== '__none__') {
      props.onMappingChange(`${CUSTOM_FIELD_MAPPING_PREFIX}${value}`, csvColumn)
    }
  }

  const handleInlineCreateSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!inlineCreate) return

    const trimmedPurpose = inlineCreate.purpose.trim()
    if (!trimmedPurpose) {
      setInlineCreate({
        ...inlineCreate,
        errorMessage: t('dataImport.mapping.customFields.purposeRequiredError'),
      })
      return
    }

    try {
      const created = await createMutation.mutateAsync({
        entity: props.entityType,
        label: inlineCreate.label.trim(),
        type: inlineCreate.type,
        options: parseSelectOptions(inlineCreate.type, inlineCreate.optionsText),
        purpose: trimmedPurpose,
        personal_data: true,
        retention_class: 'PARENT_OBJECT',
        ...(inlineCreate.confirmNoArt9 ? { confirmNoArt9: true } : {}),
      })
      clearPreviousMapping(inlineCreate.csvColumn, created.key)
      props.onMappingChange(`${CUSTOM_FIELD_MAPPING_PREFIX}${created.key}`, inlineCreate.csvColumn)
      setInlineCreate(null)
    } catch (error: unknown) {
      const body = getErrorBody(error)
      setInlineCreate({
        ...inlineCreate,
        needsArt9Confirm:
          body?.code === 'CUSTOM_FIELD_ART9_CONFIRMATION_REQUIRED' || inlineCreate.needsArt9Confirm,
        errorMessage: getErrorMessage(error, t('customFields.saveFailed')),
      })
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-4">
      <h5 className="text-sm font-medium">{t('dataImport.mapping.customFields.title')}</h5>

      <div className="space-y-3">
        {props.unmappedHeaders.map((header) => {
          const currentKey = findMappedCustomFieldKey(props.mapping, header)
          const selectValue =
            inlineCreate?.csvColumn === header ? '__create__' : currentKey || '__none__'

          return (
            <div key={header} className="space-y-3 rounded-md border border-border p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm font-medium">{header}</span>
                <div className="w-full sm:w-72">
                  <Select
                    value={selectValue}
                    onValueChange={(value) => handleSelectChange(header, value)}
                  >
                    <SelectTrigger
                      aria-label={`${header} ${t('dataImport.mapping.customFields.targetHeader')}`}
                    >
                      <SelectValue placeholder={t('dataImport.mapping.customFields.ignore')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">
                        {t('dataImport.mapping.customFields.ignore')}
                      </SelectItem>
                      {definitions.map((def) => (
                        <SelectItem key={def.key} value={def.key}>
                          {def.label} ({t(`customFields.types.${def.type}`)})
                        </SelectItem>
                      ))}
                      <SelectItem value="__create__">
                        {t('dataImport.mapping.customFields.createNew')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {inlineCreate?.csvColumn === header ? (
                <InlineCustomFieldCreateForm
                  state={inlineCreate}
                  isPending={createMutation.isPending}
                  onChange={setInlineCreate}
                  onSubmit={handleInlineCreateSubmit}
                  onCancel={() => setInlineCreate(null)}
                />
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
