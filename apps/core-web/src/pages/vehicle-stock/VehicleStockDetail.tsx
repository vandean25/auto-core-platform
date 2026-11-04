import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/layout/PageHeader'
import { DetailSkeleton } from '@/components/ui/skeleton-presets'
import { Empty, EmptyDescription } from '@/components/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusBadge } from '@/components/status/StatusBadge'
import { InlineEdit } from '@/components/inline-edit/InlineEdit'
import { CustomerSearch } from '@/components/sales/CustomerSearch'
import {
  usePatchVehicleStock,
  useVehicleStockDetail,
} from '@/api/vehicle-stock'
import { useCreateWorkshopOrder } from '@/api/workshop'
import { formatCurrency } from '@/lib/utils'
import { getErrorMessage } from '@/lib/error-utils'
import type { Customer } from '@/api/types'
import {
  VehicleRegulatorySection,
  type VehicleNovaClass,
  type VehicleRegulatoryValues,
} from '@/components/vehicles/VehicleRegulatorySection'
import {
  useLocalizedCopy,
  REGISTRATION_CERTIFICATE_HELP,
  VEHICLE_REGULATORY_FIELDS,
} from '@/components/vehicles/vehicle-regulatory-copy'

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

export default function VehicleStockDetail() {
  const { vehicleId = '' } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation('vehicleStock')

  useEffect(() => {
    void ensureNamespaceLoaded('vehicleStock')
  }, [])
  const { data: vehicle, isLoading } = useVehicleStockDetail(vehicleId)
  const patchStock = usePatchVehicleStock(vehicleId)
  const createPrep = useCreateWorkshopOrder()

  if (isLoading || !vehicle) {
    return <DetailSkeleton label={t('stockDetail.loading')} />
  }

  const canSell =
    vehicle.stock_status === 'IN_STOCK' || vehicle.stock_status === 'RESERVED'
  const canPrep = canSell

  const reservedCustomer = vehicle.reserved_for_customer
    ? ({
        id: vehicle.reserved_for_customer.id,
        first_name: vehicle.reserved_for_customer.first_name,
        last_name: vehicle.reserved_for_customer.last_name,
        company_name: vehicle.reserved_for_customer.company_name,
        type: vehicle.reserved_for_customer.company_name ? 'COMPANY' : 'PRIVATE',
        email: '',
      } as Customer)
    : null

  const saveField = async (patch: Parameters<typeof patchStock.mutateAsync>[0]) => {
    try {
      await patchStock.mutateAsync(patch)
      toast.success(t('shared.saved'))
    } catch (error) {
      toast.error(getErrorMessage(error, t('stockDetail.saveFailed')))
    }
  }

  const saveRegulatory = async (patch: Partial<VehicleRegulatoryValues>) => {
    await saveField(patch as Parameters<typeof patchStock.mutateAsync>[0])
  }

  const startPrep = async () => {
    try {
      const order = await createPrep.mutateAsync({
        vehicleId,
        purpose: 'STOCK_PREP',
        odometer: vehicle.mileage ?? 0,
        fuelLevel: 50,
      })
      navigate(`/workshop/orders/${order.id}`)
    } catch (error) {
      toast.error(getErrorMessage(error, t('stockDetail.prepFailed')))
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        className="mb-0"
        leading={
          <Button variant="ghost" size="icon" className="max-sm:min-h-11 max-sm:min-w-11" aria-label={t('stockDetail.backAria')} onClick={() => navigate('/vehicle-stock')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        }
        title={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {/* text-base keeps the VIN at its former size; PageHeader descriptions default to text-sm. */}
            <span className="text-base">{vehicle.vin || t('stockDetail.noVin')}</span>
            {vehicle.stock_status ? <StatusBadge status={vehicle.stock_status} /> : null}
          </span>
        }
        actions={
          <>
            <Button
              variant="outline"
              className="max-sm:min-h-11"
              onClick={() =>
                navigate(APP_ROUTE_PATHS.vehicleStockListing.replace(':vehicleId', vehicleId))
              }
            >
              {t('listing.title')}
            </Button>
            <Button variant="outline" className="max-sm:min-h-11" disabled={!canPrep} onClick={() => void startPrep()}>
              {t('stockDetail.stockPrep')}
            </Button>
            <Button
              className="max-sm:min-h-11"
              disabled={!canSell}
              onClick={() => navigate(`/vehicle-stock/sales/new?vehicleId=${vehicleId}`)}
            >
              {t('stockDetail.sell')}
            </Button>
          </>
        }
      />

      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-lg border p-4 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t('stockDetail.details')}</h2>
          <div>
            <div className="text-xs text-muted-foreground">{t('stockDetail.costBasis')}</div>
            <div className="font-medium">{formatCurrency(vehicle.cost_basis)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">{t('stockDetail.mileage')}</div>
            <InlineEdit
              value={vehicle.mileage != null ? String(vehicle.mileage) : ''}
              placeholder={t('stockDetail.mileage')}
              onSave={(next) => saveField({ mileage: Number(next) || 0 })}
            />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">{t('stockDetail.color')}</div>
            <InlineEdit
              value={vehicle.color}
              placeholder={t('stockDetail.color')}
              onSave={(next) => saveField({ color: next })}
            />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">{t('stockDetail.keyNumber')}</div>
            <InlineEdit
              value={vehicle.key_number}
              placeholder={t('stockDetail.keyNumber')}
              onSave={(next) => saveField({ key_number: next })}
            />
          </div>
          <RegistrationCertificateField
            value={vehicle.registration_certificate_no}
            onSave={(next) => saveField({ registration_certificate_no: next })}
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
              onChange={(customer) => {
                void saveField({ reserved_for_customer_id: customer?.id ?? null })
              }}
            />
          </div>
        </div>

        <div className="rounded-lg border p-4 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t('stockDetail.ledger')}</h2>
          {vehicle.ledger_entries.length === 0 ? (
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
                {vehicle.ledger_entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{entry.entry_type}</TableCell>
                    <TableCell className="text-right">{formatCurrency(entry.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  )
}
