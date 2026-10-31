import { useTranslation } from 'react-i18next'
import { useCustomer } from '@/api/customers'
import { useVehicle } from '@/api/vehicles'
import { useBay } from '@/api/bays'
import { useMySites } from '@/api/sites'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/format'
import type { WorkshopCommandIntent } from '@/api/workshop-command'

type WorkshopCommandPreviewProps = {
  intent: WorkshopCommandIntent
  busy: boolean
  applyDisabled?: boolean
  onEditSentence: () => void
  onApply: () => void
}

type PreviewLine = WorkshopCommandIntent['position_plan']['lines'][number]

function formatEuros(cents: number): string {
  return formatCurrency(cents / 100)
}

function vehicleText(data: { make?: string | null; model?: string | null; plate?: string | null } | undefined): string {
  if (!data) return ''
  const model = [data.make, data.model].filter(Boolean).join(' ')
  return data.plate ? `${model} — ${data.plate}` : model
}

function customerText(data: { company_name?: string | null; first_name?: string | null; last_name?: string | null } | undefined): string {
  const company = data?.company_name?.trim()
  if (company) return company
  return [data?.first_name, data?.last_name].filter(Boolean).join(' ')
}

function pick(value: string | null | undefined, fallback: string): string {
  return value ? value : fallback
}

/** Reads the resolved identifiers back into display labels; no rules are applied. */
function usePreviewLabels(intent: WorkshopCommandIntent) {
  const { t } = useTranslation('workshop')
  const customer = useCustomer(intent.customer_id)
  const vehicle = useVehicle(intent.vehicle_id)
  const bay = useBay(intent.bay_id)
  const sites = useMySites()
  const schedule = intent.schedule
  const site = sites.data?.find((entry) => entry.id === intent.site_id)
  return {
    customer: pick(customerText(customer.data), intent.customer_id),
    vehicle: pick(vehicleText(vehicle.data), intent.vehicle_id),
    site: pick(site?.name, intent.site_id),
    time: `${schedule.local_date} ${schedule.local_start}–${schedule.local_end} (${t('command.durationMinutes', { count: schedule.duration_minutes })})`,
    bay: pick(bay.data?.name, intent.bay_id),
    loaner: intent.loaner.requested ? t('command.loanerRequested') : t('command.loanerNone'),
  }
}

/**
 * Read-only review of the server-resolved intent. Every value comes from the
 * API; the surface never derives customer, bay, price, or time rules itself.
 */
export function WorkshopCommandPreview({
  intent,
  busy,
  applyDisabled = false,
  onEditSentence,
  onApply,
}: WorkshopCommandPreviewProps) {
  const { t } = useTranslation('workshop')
  const labels = usePreviewLabels(intent)

  return (
    <section aria-labelledby="workshop-command-preview-heading" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id="workshop-command-preview-heading" className="text-sm font-semibold">
          {t('command.previewHeading')}
        </h3>
        <Badge variant="secondary">{t('command.previewHint')}</Badge>
      </div>
      <PreviewDetails labels={labels} />
      <PreviewLines lines={intent.position_plan.lines} />
      <PreviewActions
        busy={busy}
        applyDisabled={applyDisabled}
        onEditSentence={onEditSentence}
        onApply={onApply}
      />
    </section>
  )
}

function PreviewDetails({ labels }: { labels: ReturnType<typeof usePreviewLabels> }) {
  const { t } = useTranslation('workshop')
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
      <PreviewRow label={t('command.fieldCustomer')} value={labels.customer} />
      <PreviewRow label={t('command.fieldVehicle')} value={labels.vehicle} />
      <PreviewRow label={t('command.fieldSite')} value={labels.site} />
      <PreviewRow label={t('command.fieldTime')} value={labels.time} />
      <PreviewRow label={t('command.fieldBay')} value={labels.bay} />
      <PreviewRow label={t('command.fieldLoaner')} value={labels.loaner} />
    </dl>
  )
}

function PreviewLines({ lines }: { lines: PreviewLine[] }) {
  const { t } = useTranslation('workshop')
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">{t('command.fieldLines')}</p>
      <ul className="space-y-1 text-sm">
        {lines.map((line, index) => (
          <li
            key={`${line.preset_key ?? line.description}-${index}`}
            className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-border/60 px-2 py-1"
          >
            <span>
              {line.description}
              <span className="ml-2 text-xs text-muted-foreground">
                {line.quantity} {line.unit}
              </span>
            </span>
            <span className="text-xs text-muted-foreground">{formatEuros(line.net_cents)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function PreviewActions({
  busy,
  applyDisabled,
  onEditSentence,
  onApply,
}: {
  busy: boolean
  applyDisabled: boolean
  onEditSentence: () => void
  onApply: () => void
}) {
  const { t } = useTranslation('workshop')
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" data-action-id="workshopCommand.apply" onClick={onApply} disabled={busy || applyDisabled}>
        {busy ? t('command.applying') : t('command.apply')}
      </Button>
      <Button type="button" variant="outline" data-action-id="workshopCommand.edit" onClick={onEditSentence} disabled={busy}>
        {t('command.editSentence')}
      </Button>
    </div>
  )
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  )
}
