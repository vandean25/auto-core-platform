import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { TyreSetsSummary } from '@/features/tyre-storage/TyreSetsSummary'
import { InlineEdit } from '@/components/inline-edit/InlineEdit'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NovaPreviewPanel } from '@/components/vehicles/NovaPreviewPanel'
import { VehicleGewaehrleistungSection } from '@/components/vehicles/VehicleGewaehrleistungSection'
import { VehiclePickerlSection } from '@/components/vehicles/VehiclePickerlSection'
import { VehicleRegulatorySection } from '@/components/vehicles/VehicleRegulatorySection'
import type { VehicleNovaClass } from '@/components/vehicles/VehicleRegulatorySection'
import {
  getCustomerName,
  getFirstRegistrationDate,
  type VehicleDetailResponse,
} from './vehicle-detail-model'
import { useVehicleFieldSaves, type EditableVehicleField } from './useVehicleDetailMutations'

type VehicleInfoCardProps = {
  vehicle: VehicleDetailResponse
  onChangeCustomer: () => void
}

type EditableFieldConfig = {
  field: EditableVehicleField
  label: string
  value: string | null | undefined
  placeholder: string
  ariaLabel: string
  emptyText?: string
  wide?: boolean
}

export function VehicleInfoCard({ vehicle, onChangeCustomer }: VehicleInfoCardProps) {
  const { t } = useTranslation('vehicles')
  const { saveRegulatoryField, saveVehicleField } = useVehicleFieldSaves(vehicle.id)
  const firstRegistrationDate = getFirstRegistrationDate(vehicle)

  const editableFields: EditableFieldConfig[] = [
    {
      field: 'year',
      label: t('detail.year'),
      value: String(vehicle.year),
      placeholder: t('detail.placeholders.year'),
      ariaLabel: t('detail.aria.year'),
    },
    {
      field: 'engine_code',
      label: t('detail.engine'),
      value: vehicle.engine_code,
      placeholder: t('detail.placeholders.engineCode'),
      emptyText: t('detail.empty.engineCode'),
      ariaLabel: t('detail.aria.engineCode'),
    },
    {
      field: 'make',
      label: t('detail.make'),
      value: vehicle.make,
      placeholder: t('detail.placeholders.make'),
      ariaLabel: t('detail.aria.make'),
    },
    {
      field: 'model',
      label: t('detail.model'),
      value: vehicle.model,
      placeholder: t('detail.placeholders.model'),
      ariaLabel: t('detail.aria.model'),
    },
    {
      field: 'vin',
      label: t('detail.vin'),
      value: vehicle.vin,
      placeholder: t('detail.placeholders.vin'),
      emptyText: t('detail.empty.vin'),
      ariaLabel: t('detail.aria.vin'),
      wide: true,
    },
    {
      field: 'plate',
      label: t('detail.plate'),
      value: vehicle.plate,
      placeholder: t('detail.placeholders.plate'),
      emptyText: t('detail.empty.plate'),
      ariaLabel: t('detail.aria.plate'),
      wide: true,
    },
  ]

  return (
    <Card className='lg:col-span-1'>
      <CardHeader>
        <CardTitle className='text-base font-semibold'>{t('detail.vehicleInfo')}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-3 text-sm'>
        {vehicle.customer?.id ? (
          <TyreSetsSummary vehicleId={vehicle.id} customerId={vehicle.customer.id} />
        ) : null}
        <div className='grid grid-cols-2 gap-3'>
          {editableFields.map(({ field, label, value, placeholder, emptyText, ariaLabel, wide }) => (
            <div key={field} className={wide ? 'col-span-2' : undefined}>
              <div className='text-muted-foreground'>{label}</div>
              <InlineEdit
                value={value}
                onSave={(nextValue) => saveVehicleField(field, nextValue)}
                placeholder={placeholder}
                emptyText={emptyText}
                ariaLabel={ariaLabel}
              />
            </div>
          ))}
        </div>

        <VehiclePickerlSection vehicleId={vehicle.id} pickerlDue={vehicle.pickerl_due} />

        <VehicleGewaehrleistungSection sales={vehicle.sales ?? []} />

        <VehicleRegulatorySection
          mode='inline'
          values={{
            first_registration_date: firstRegistrationDate,
            co2_wltp_g_km: vehicle.co2_wltp_g_km ?? null,
            co2_nedc_g_km: vehicle.co2_nedc_g_km ?? null,
            typenschein_no: vehicle.typenschein_no ?? null,
            nova_class: (vehicle.nova_class as VehicleNovaClass | null) ?? null,
            emission_class: vehicle.emission_class ?? null,
          }}
          onChange={(patch) => void saveRegulatoryField(patch)}
          renderInlineField={(field, label, value, onSave) => (
            <div key={field}>
              <div className='text-muted-foreground'>{label}</div>
              <InlineEdit value={value} onSave={onSave} ariaLabel={label} />
            </div>
          )}
        />

        <NovaPreviewPanel
          vehicleId={vehicle.id}
          firstRegistrationDate={firstRegistrationDate}
          co2Wltp={vehicle.co2_wltp_g_km ?? null}
          co2Nedc={vehicle.co2_nedc_g_km ?? null}
          typenscheinNo={vehicle.typenschein_no ?? null}
          novaClass={vehicle.nova_class ?? null}
        />

        <div className='pt-3 border-t'>
          <div className='flex items-center justify-between gap-2 mb-1'>
            <div className='text-muted-foreground'>{t('detail.customer')}</div>
            <Button variant='outline' size='sm' className='h-7 px-2' onClick={onChangeCustomer}>
              {t('detail.changeCustomer')}
            </Button>
          </div>
          {vehicle.customer ? (
            <Link
              className='font-medium hover:underline'
              to={`/customers/${vehicle.customer.id}`}
              data-testid='vehicle-customer-link'
            >
              {getCustomerName(vehicle.customer)}
            </Link>
          ) : (
            <span className='font-medium'>{t('shared.unassigned')}</span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
