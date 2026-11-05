import { useTranslation } from 'react-i18next'
import type {
  AccountingExportBlockerCode,
  AccountingExportDocumentKind,
  AccountingExportReadinessResponse,
} from '@/api/useAccountingExportReadiness'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DateField } from '@/components/ui/date-field'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

const ALL_FILTER_VALUE = 'all'

const FILTERABLE_REASON_CODES = (
  [
    'LEGACY_DOCUMENT_UNSUPPORTED',
    'UNSUPPORTED_EXPORT_TAX_MODE',
    'UNSUPPORTED_EXPORT_COUNTRY',
    'ACCOUNTING_MAPPING_INCOMPLETE',
    'MISSING_OWNERSHIP_EVIDENCE',
    'CANCELLED_DOCUMENT',
    'INACTIVE_SITE_BLOCKED',
  ] as AccountingExportBlockerCode[]
).filter((code) => code !== 'INACTIVE_SITE_BLOCKED')

const DOCUMENT_KINDS: AccountingExportDocumentKind[] = ['INVOICE', 'CREDIT_NOTE']

type Period = { dateFrom: string; dateTo: string }

/** Select with a leading "all" entry; the empty string stands for "all". */
function AllOptionSelect<T extends string>({
  id,
  label,
  allLabel,
  value,
  options,
  optionLabel,
  onChange,
}: {
  id: string
  label: string
  allLabel: string
  value: T | ''
  options: readonly T[]
  optionLabel: (option: T) => string
  onChange: (value: T | '') => void
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value || ALL_FILTER_VALUE}
        onValueChange={(next) => onChange(next === ALL_FILTER_VALUE ? '' : (next as T))}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder={allLabel} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_FILTER_VALUE}>{allLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {optionLabel(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function ReadinessFilters({
  legalEntities,
  legalEntityId,
  period,
  reason,
  documentKind,
  onEntityChange,
  onPeriodChange,
  onReasonChange,
  onDocumentKindChange,
}: {
  legalEntities: Array<{ id: string; name: string }>
  legalEntityId: string
  period: Period
  reason: AccountingExportBlockerCode | ''
  documentKind: AccountingExportDocumentKind | ''
  onEntityChange: (id: string) => void
  onPeriodChange: (patch: Partial<Period>) => void
  onReasonChange: (reason: AccountingExportBlockerCode | '') => void
  onDocumentKindChange: (kind: AccountingExportDocumentKind | '') => void
}) {
  const { t } = useTranslation('finance')

  return (
    <div className="grid gap-4 md:grid-cols-5 mb-6">
      <div className="space-y-1.5">
        <Label htmlFor="readiness-entity">{t('accountingExportReadiness.legalEntity')}</Label>
        <Select value={legalEntityId} onValueChange={onEntityChange} disabled={legalEntities.length === 0}>
          <SelectTrigger id="readiness-entity">
            <SelectValue placeholder={t('accountingExportReadiness.chooseLegalEntity')} />
          </SelectTrigger>
          <SelectContent>
            {legalEntities.map((entity) => (
              <SelectItem key={entity.id} value={entity.id}>
                {entity.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="readiness-from">{t('accountingExportReadiness.from')}</Label>
        <DateField id="readiness-from" value={period.dateFrom} onChange={(next) => onPeriodChange({ dateFrom: next })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="readiness-to">{t('accountingExportReadiness.to')}</Label>
        <DateField id="readiness-to" value={period.dateTo} onChange={(next) => onPeriodChange({ dateTo: next })} />
      </div>
      <AllOptionSelect
        id="readiness-reason"
        label={t('accountingExportReadiness.reasonFilter')}
        allLabel={t('accountingExportReadiness.allReasons')}
        value={reason}
        options={FILTERABLE_REASON_CODES}
        optionLabel={(code) => t(`accountingExportReadiness.blockers.${code}`)}
        onChange={onReasonChange}
      />
      <AllOptionSelect
        id="readiness-kind"
        label={t('accountingExportReadiness.documentType')}
        allLabel={t('accountingExportReadiness.allTypes')}
        value={documentKind}
        options={DOCUMENT_KINDS}
        optionLabel={(kind) => t(`accountingExportReadiness.documentKind.${kind}`)}
        onChange={onDocumentKindChange}
      />
    </div>
  )
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string | number | undefined
  tone?: 'positive' | 'negative'
}) {
  const { t } = useTranslation('finance')
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p
          className={cn(
            'text-2xl font-semibold tabular-nums',
            tone === 'positive' && 'text-success',
            tone === 'negative' && 'text-destructive',
          )}
        >
          {value ?? t('placeholders.missing', { ns: 'common' })}
        </p>
      </CardContent>
    </Card>
  )
}

export function ReadinessSummary({ response }: { response: AccountingExportReadinessResponse | undefined }) {
  const { t } = useTranslation('finance')
  const summary = response?.summary
  const periodLabel = response?.periodClosed
    ? t('accountingExportReadiness.periodClosed')
    : response
      ? t('accountingExportReadiness.periodOpen')
      : undefined

  return (
    <section aria-label={t('accountingExportReadiness.summaryRegion')} className="grid gap-4 md:grid-cols-4 mb-6">
      <SummaryCard label={t('accountingExportReadiness.documents')} value={summary?.documentCount} />
      <SummaryCard label={t('accountingExportReadiness.exportable')} value={summary?.exportableCount} tone="positive" />
      <SummaryCard label={t('accountingExportReadiness.blocked')} value={summary?.blockedCount} tone="negative" />
      <SummaryCard label={t('accountingExportReadiness.period')} value={periodLabel} />
    </section>
  )
}

export function ReasonChips({
  reasons,
  selectedReason,
  onToggle,
}: {
  reasons: Array<{ code: AccountingExportBlockerCode; documentCount: number }>
  selectedReason: AccountingExportBlockerCode | ''
  onToggle: (code: AccountingExportBlockerCode | '') => void
}) {
  const { t } = useTranslation('finance')
  if (reasons.length === 0) return null

  return (
    <div aria-label={t('accountingExportReadiness.blockerReasonsRegion')} className="flex flex-wrap gap-2 mb-6">
      {reasons.map((item) => {
        const selected = selectedReason === item.code
        return (
          <button
            key={item.code}
            type="button"
            aria-pressed={selected}
            onClick={() => onToggle(selected ? '' : item.code)}
            className={cn(
              'rounded-md border px-3 py-1.5 text-sm transition-colors',
              selected
                ? 'border-foreground bg-foreground text-background'
                : 'border-border bg-card text-foreground hover:bg-muted/50',
            )}
          >
            {t(`accountingExportReadiness.blockers.${item.code}`)}{' '}
            <span className="tabular-nums">{item.documentCount}</span>
          </button>
        )
      })}
    </div>
  )
}

export function ReadinessNotices({ response }: { response: AccountingExportReadinessResponse | undefined }) {
  const { t } = useTranslation('finance')
  const blockers = response?.tenantWideBlockers ?? []

  return (
    <>
      {response && !response.exportProfile.canGenerate ? (
        <Alert className="mb-6">
          <AlertDescription>
            {response.exportProfile.configured
              ? t('accountingExportReadiness.exportProfileDisabled')
              : t('accountingExportReadiness.exportProfileMissing')}
          </AlertDescription>
        </Alert>
      ) : null}

      {blockers.length > 0 ? (
        <Alert className="mb-6">
          <AlertDescription>
            <p className="font-medium">{t('accountingExportReadiness.tenantWideIssue', { count: blockers.length })}</p>
            <ul className="mt-2 list-disc pl-5">
              {blockers.map((blocker, index) => (
                <li key={`${blocker.code}-${blocker.documentId ?? index}`}>{blocker.message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  )
}
