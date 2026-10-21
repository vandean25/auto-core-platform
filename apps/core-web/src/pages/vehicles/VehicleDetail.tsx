import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { useVehicle } from '@/api/vehicles'
import { StartServiceDialog } from '@/components/workshop/StartServiceDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { VehicleDialog } from '@/components/vehicles/VehicleDialog'
import { ChangeCustomerDialog } from './ChangeCustomerDialog'
import { VehicleInfoCard } from './VehicleInfoCard'
import { VehicleOrderTabs } from './VehicleOrderTabs'
import { useChangeCustomer } from './useVehicleDetailMutations'
import { getVehicleDescription, type VehicleDetailResponse } from './vehicle-detail-model'

function VehicleDetailContent({ vehicle }: { vehicle: VehicleDetailResponse }) {
  const { t } = useTranslation('vehicles')
  const navigate = useNavigate()
  const [startServiceOpen, setStartServiceOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const { openDialog: openCustomerDialog, dialogProps: customerDialogProps } = useChangeCustomer(vehicle)

  const handleCreateServiceOrder = () => {
    if (!vehicle.customer?.id) {
      toast.error(t('detail.serviceOrderNeedsCustomer'))
      return
    }
    setStartServiceOpen(true)
  }

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between mb-8'>
        <div className='flex items-center gap-4'>
          <Button
            variant='ghost'
            size='icon'
            onClick={() => navigate(-1)}
            aria-label={t('detail.aria.goBack')}
          >
            <ArrowLeft className='h-4 w-4' />
          </Button>
          <div>
            <h1 className='text-2xl font-semibold tracking-tight'>
              {vehicle.year} {vehicle.make} {vehicle.model}
            </h1>
            <div className='flex items-center gap-2 text-slate-500 text-sm'>
              <span>{t('detail.idLabel', { id: vehicle.id.substring(0, 8) })}</span>
              {vehicle.plate && <Badge variant='outline'>{vehicle.plate}</Badge>}
            </div>
          </div>
        </div>
        <div className='flex gap-2'>
          <Button variant='outline' onClick={() => setEditDialogOpen(true)}>
            {t('detail.editVehicle')}
          </Button>
          <Button variant='outline' onClick={handleCreateServiceOrder}>
            <Wrench className='mr-2 h-4 w-4' /> {t('detail.serviceOrder')}
          </Button>
        </div>
      </div>

      <VehicleDialog
        vehicle={vehicle}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
      />

      <div className='grid grid-cols-1 lg:grid-cols-3 gap-6 items-start'>
        <VehicleInfoCard vehicle={vehicle} onChangeCustomer={openCustomerDialog} />
        <div className='lg:col-span-2'>
          <VehicleOrderTabs vehicle={vehicle} />
        </div>
      </div>

      <ChangeCustomerDialog {...customerDialogProps} />

      {vehicle.customer && (
        <StartServiceDialog
          open={startServiceOpen}
          onOpenChange={setStartServiceOpen}
          customerId={vehicle.customer.id}
          vehicleId={vehicle.id}
          vehicleDescription={getVehicleDescription(vehicle)}
          onCreated={(order) => navigate(`/workshop/orders/${order.id}`)}
        />
      )}
    </div>
  )
}

export default function VehicleDetail() {
  const { t } = useTranslation('vehicles')
  useEffect(() => {
    void ensureNamespaceLoaded('vehicles')
  }, [])
  const { id = '' } = useParams<{ id: string }>()
  const { data: vehicle, isLoading, isError, error } = useVehicle<VehicleDetailResponse>(id)

  if (isLoading) {
    return <div className='p-8 text-center'>{t('detail.loading')}</div>
  }

  if (isError) {
    return (
      <div className='p-8 text-center'>
        {t('detail.loadFailed', {
          message: (error as Error)?.message || t('shared.unknownError'),
        })}
      </div>
    )
  }

  if (!vehicle) {
    return <div className='p-8 text-center'>{t('detail.notFound')}</div>
  }

  return <VehicleDetailContent vehicle={vehicle} />
}
