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

function formatEuros(cents: number): string {
  return formatCurrency(cents / 100)
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
  const customer = useCustomer(intent.customer_id)
  const vehicle = useVehicle(intent.vehicle_id)
  const bay = useBay(intent.bay_id)
  const sites = useMySites()

  const customerName =
    customer.data?.company_name?.trim() ||
    [customer.data?.first_name, customer.data?.last_name].filter(Boolean).join(' ')
  const vehicleLabel = vehicle.data
    ? [vehicle.data.make, vehicle.data.model].filter(Boolean).join(' ')
    : ''
  const siteName = sites.data?.find((site) => site.id === intent.site_id)?.name
  const loaner = intent.loaner

  return (
    <section aria-labelledby="workshop-command-preview-heading" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id="workshop-command-preview-heading" className="text-sm font-semibold">
          {t('command.previewHeading')}
        </h3>
        <Badge variant="secondary">{t('command.previewHint')}</Badge>
      </div>

      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <PreviewRow label={t('command.fieldCustomer')} value={customerName || intent.customer_id} />
        <PreviewRow
          label={t('command.fieldVehicle')}
          value={
            vehicle.data
              ? `${vehicleLabel}${vehicle.data.plate ? ` — ${vehicle.data.plate}` : ''}`
              : intent.vehicle_id
          }
        />
        <PreviewRow label={t('command.fieldSite')} value={siteName || intent.site_id} />
        <PreviewRow
          label={t('command.fieldTime')}
          value={`${intent.schedule.local_date} ${intent.schedule.local_start}–${intent.schedule.local_end} (${t('command.durationMinutes', { count: intent.schedule.duration_minutes })})`}
        />
        <PreviewRow label={t('command.fieldBay')} value={bay.data?.name || intent.bay_id} />
        <PreviewRow
          label={t('command.fieldLoaner')}
          value={
            loaner.requested
              ? t('command.loanerRequested')
              : t('command.loanerNone')
          }
        />
      </dl>

      <div className="space-y-1">
        <p className="text-sm font-medium">{t('command.fieldLines')}</p>
        <ul className="space-y-1 text-sm">
          {intent.position_plan.lines.map((line, index) => (
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

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onApply} disabled={busy || applyDisabled}>
          {busy ? t('command.applying') : t('command.apply')}
        </Button>
        <Button type="button" variant="outline" onClick={onEditSentence} disabled={busy}>
          {t('command.editSentence')}
        </Button>
      </div>
    </section>
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
