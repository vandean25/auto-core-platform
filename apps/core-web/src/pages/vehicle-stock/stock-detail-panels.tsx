import { useTranslation } from 'react-i18next'

import type { Customer } from '@/api/types'
import type { VehicleStockDetail } from '@/api/vehicle-stock'
import { InlineEdit } from '@/components/inline-edit/InlineEdit'
import { CustomerSearch } from '@/components/sales/CustomerSearch'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { VehicleRegulatorySection, type VehicleNovaClass } from '@/components/vehicles/VehicleRegulatorySection'
import {
  useLocalizedCopy,
  REGISTRATION_CERTIFICATE_HELP,
  VEHICLE_REGULATORY_FIELDS,
} from '@/components/vehicles/vehicle-regulatory-copy'
import { FieldSaveFailures } from '@/features/interaction/use-optimistic-field-save'
import { formatCurrency } from '@/lib/utils'
import { useVehicleStockFieldSaves } from './useVehicleStockFieldSaves'

function RegistrationCertificateField({
  value,
  onSave,
}: {
  value: string | null | undefined
  onSave: (next: string) => void | Promise<void>
}) {
  const { t } = useTranslation('vehicleStock')
  const localized = useLocalizedCopy()

  return (
    <div>
      <div className="text-xs text-muted-foreground">
        {localized(VEHICLE_REGULATORY_FIELDS.registrationCertificate)}
      </div>
      <p className="text-xs text-muted-foreground mb-1">{localized(REGISTRATION_CERTIFICATE_HELP)}</p>
      <InlineEdit
        value={value}
        placeholder={t('stockDetail.certificatePlaceholder')}
        onSave={onSave}
      />
    </div>
  )
}

function toReservedCustomer(vehicle: VehicleStockDetail): Customer | null {
  const reserved = vehicle.reserved_for_customer
  if (!reserved) return null
  return {
    id: reserved.id,
    first_name: reserved.first_name,
    last_name: reserved.last_name,
    company_name: reserved.company_name,
    type: reserved.company_name ? 'COMPANY' : 'PRIVATE',
    email: '',
  } as Customer
}

export function StockDetailsPanel({ vehicle, vehicleId }: { vehicle: VehicleStockDetail; vehicleId: string }) {
  const { t } = useTranslation('vehicleStock')
  const { descriptiveSave, reserving, reserve, saveRegulatory } = useVehicleStockFieldSaves(vehicleId)
  const reservedCustomer = toReservedCustomer(vehicle)

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t('stockDetail.details')}</h2>
      <FieldSaveFailures
        failures={descriptiveSave.failures}
        message={(field) =>
          t('stockDetail.fieldSaveFailed', {
            record: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
            field: t(`stockDetail.fieldLabels.${field}`),
          })
        }
        onRetry={descriptiveSave.retry}
        onDismiss={descriptiveSave.dismiss}
      />
      <div>
        <div className="text-xs text-muted-foreground">{t('stockDetail.costBasis')}</div>
        <div className="font-medium">{formatCurrency(vehicle.cost_basis)}</div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">{t('stockDetail.mileage')}</div>
        <InlineEdit
          value={vehicle.mileage != null ? String(vehicle.mileage) : ''}
          placeholder={t('stockDetail.mileage')}
          onSave={(next) => descriptiveSave.saveField('mileage', next)}
        />
      </div>
      <div>
        <div className="text-xs text-muted-foreground">{t('stockDetail.color')}</div>
        <InlineEdit
          value={vehicle.color}
          placeholder={t('stockDetail.color')}
          onSave={(next) => descriptiveSave.saveField('color', next)}
        />
      </div>
      <div>
        <div className="text-xs text-muted-foreground">{t('stockDetail.keyNumber')}</div>
        <InlineEdit
          value={vehicle.key_number}
          placeholder={t('stockDetail.keyNumber')}
          onSave={(next) => descriptiveSave.saveField('key_number', next)}
        />
      </div>
      <RegistrationCertificateField
        value={vehicle.registration_certificate_no}
        onSave={(next) => descriptiveSave.saveField('registration_certificate_no', next)}
      />
      <VehicleRegulatorySection
        mode="inline"
        values={{
          first_registration_date:
            typeof vehicle.first_registration_date === 'string'
              ? vehicle.first_registration_date.slice(0, 10)
              : vehicle.first_registration_date ?? null,
          co2_wltp_g_km: vehicle.co2_wltp_g_km ?? null,
          co2_nedc_g_km: vehicle.co2_nedc_g_km ?? null,
          typenschein_no: vehicle.typenschein_no ?? null,
          nova_class: (vehicle.nova_class as VehicleNovaClass | null) ?? null,
          emission_class: vehicle.emission_class ?? null,
        }}
        onChange={(patch) => void saveRegulatory(patch)}
        renderInlineField={(field, label, value, onSave) => (
          <div key={field}>
            <div className="text-xs text-muted-foreground">{label}</div>
            <InlineEdit value={value} onSave={onSave} ariaLabel={label} />
          </div>
        )}
      />
      <div>
        <div className="text-xs text-muted-foreground mb-1">{t('stockDetail.reservedFor')}</div>
        <CustomerSearch
          value={reservedCustomer}
          pending={reserving}
          onChange={(customer) => void reserve(customer?.id ?? null)}
        />
      </div>
    </div>
  )
}

export function StockLedgerPanel({ entries }: { entries: VehicleStockDetail['ledger_entries'] }) {
  const { t } = useTranslation('vehicleStock')

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t('stockDetail.ledger')}</h2>
      {entries.length === 0 ? (
        <Empty className="p-6 md:p-6">
          <EmptyDescription>{t('stockDetail.noLedger')}</EmptyDescription>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('stockDetail.ledgerType')}</TableHead>
              <TableHead className="text-right">{t('stockDetail.ledgerAmount')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell>{entry.entry_type}</TableCell>
                <TableCell className="text-right">{formatCurrency(entry.amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
