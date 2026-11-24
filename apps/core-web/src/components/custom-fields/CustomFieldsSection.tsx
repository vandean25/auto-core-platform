import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuthSession } from '@/api/auth-session'
import {
  useCustomFieldDefinitions,
  type CustomFieldDefinition,
  type CustomFieldEntity,
} from '@/api/custom-fields'
import { InlineEdit } from '@/components/inline-edit/InlineEdit'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getErrorMessage } from '@/lib/error-utils'

const CLEAR_SELECT_VALUE = '__clear__'

type CustomFieldsSectionProps = {
  entity: CustomFieldEntity
  values?: Record<string, unknown> | null
  onSaveField: (key: string, value: string | number | boolean | null) => Promise<unknown>
}

function CustomFieldRow({
  def,
  rawValue,
  onSaveField,
}: {
  def: CustomFieldDefinition
  rawValue: unknown
  onSaveField: (key: string, value: string | number | boolean | null) => Promise<unknown>
}) {
  const { t } = useTranslation('common')

  const saveWithToast = async (next: string | number | boolean | null) => {
    try {
      await onSaveField(def.key, next)
      toast.success(t('customFields.saved'))
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('customFields.saveFailed')))
      throw error
    }
  }

  if (def.type === 'BOOLEAN') {
    const checked = rawValue === true
    return (
      <div className="flex items-center justify-between gap-2 py-1">
        <span className="text-xs text-muted-foreground" title={def.purpose}>
          {def.label}
        </span>
        <Checkbox
          aria-label={def.label}
          checked={checked}
          onCheckedChange={(next) => {
            void saveWithToast(next === true).catch(() => undefined)
          }}
        />
      </div>
    )
  }

  if (def.type === 'SELECT') {
    const current = typeof rawValue === 'string' ? rawValue : CLEAR_SELECT_VALUE
    return (
      <div>
        <div className="text-xs text-muted-foreground mb-1" title={def.purpose}>
          {def.label}
        </div>
        <Select
          value={current}
          onValueChange={(next) => {
            const payload = next === CLEAR_SELECT_VALUE ? null : next
            void saveWithToast(payload).catch(() => undefined)
          }}
        >
          <SelectTrigger aria-label={def.label} className="h-8 text-sm">
            <SelectValue placeholder={t('customFields.selectPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={CLEAR_SELECT_VALUE}>
              {t('customFields.clearOption')}
            </SelectItem>
            {(def.options ?? []).map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  const displayValue =
    rawValue === undefined || rawValue === null ? '' : String(rawValue)

  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1" title={def.purpose}>
        {def.label}
      </div>
      <InlineEdit
        value={displayValue}
        maxLength={500}
        placeholder={def.type === 'DATE' ? 'YYYY-MM-DD' : t('customFields.placeholder')}
        emptyText={t('customFields.emptyValue')}
        ariaLabel={def.label}
        onSave={async (nextText) => {
          const trimmed = nextText.trim()
          if (!trimmed) {
            await saveWithToast(null)
            return
          }
          if (def.type === 'NUMBER') {
            const parsed = Number(trimmed)
            await saveWithToast(Number.isFinite(parsed) ? parsed : (trimmed as unknown as number))
            return
          }
          await saveWithToast(trimmed)
        }}
      />
    </div>
  )
}

function CustomFieldsSectionContent({
  entity,
  values,
  onSaveField,
}: CustomFieldsSectionProps) {
  const { t } = useTranslation('common')
  const { data: definitions = [] } = useCustomFieldDefinitions(entity, {
    enabled: true,
  })
  const activeDefinitions = definitions.filter((def) => !def.archived)

  if (activeDefinitions.length === 0) {
    return null
  }

  return (
    <div className="pt-3 border-t border-border space-y-2.5" data-testid={`custom-fields-section-${entity.toLowerCase()}`}>
      <div className="text-xs font-medium text-muted-foreground">
        {t('customFields.sectionTitle')}
      </div>
      <div className="space-y-2">
        {activeDefinitions.map((def) => (
          <CustomFieldRow
            key={def.id}
            def={def}
            rawValue={values?.[def.key]}
            onSaveField={onSaveField}
          />
        ))}
      </div>
    </div>
  )
}

export function CustomFieldsSection({
  entity,
  values,
  onSaveField,
}: CustomFieldsSectionProps) {
  const { data: session } = useAuthSession()
  if (!session?.customFieldsEnabled) {
    return null
  }

  return (
    <CustomFieldsSectionContent
      entity={entity}
      values={values}
      onSaveField={onSaveField}
    />
  )
}
