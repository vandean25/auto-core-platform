import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { StartServiceDialog } from '@/components/workshop/StartServiceDialog'
import type { Vehicle } from '@/api/types'

type CustomerStartServiceProps = {
  customerId: string
  vehicles: Vehicle[]
}

const getVehicleDescription = (vehicle: Vehicle) => {
  const base = `${vehicle.year} ${vehicle.make} ${vehicle.model}`
  return vehicle.plate ? `${base} (${vehicle.plate})` : base
}

/** "Start service" button plus the vehicle picker and the service dialog it opens. */
export function CustomerStartService({ customerId, vehicles }: CustomerStartServiceProps) {
  const { t } = useTranslation('customers')
  const navigate = useNavigate()
  const [vehiclePickerOpen, setVehiclePickerOpen] = useState(false)
  const [selectedWorkshopVehicle, setSelectedWorkshopVehicle] = useState<Vehicle | null>(null)
  const notAvailable = t('detail.notAvailable')

  const handleCreateWorkshopOrder = () => {
    if (vehicles.length === 0) {
      toast.error(t('detail.noVehicleForService'))
      return
    }

    if (vehicles.length === 1) {
      setSelectedWorkshopVehicle(vehicles[0])
      return
    }

    setVehiclePickerOpen(true)
  }

  return (
    <>
      <Button variant='outline' onClick={handleCreateWorkshopOrder}>
        <Wrench className='mr-2 h-4 w-4' /> {t('detail.startService')}
      </Button>

      <Dialog open={vehiclePickerOpen} onOpenChange={setVehiclePickerOpen}>
        <DialogContent className='sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>{t('detail.selectVehicleTitle')}</DialogTitle>
          </DialogHeader>
          <div className='space-y-2 max-h-80 overflow-auto'>
            {vehicles.map((vehicle) => (
              <button
                key={vehicle.id}
                type='button'
                className='w-full rounded-lg border px-3 py-2 text-left hover:bg-accent'
                aria-label={t('detail.aria.selectVehicle', {
                  description: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
                  vin: vehicle.vin || notAvailable,
                  plate: vehicle.plate || notAvailable,
                })}
                onClick={() => {
                  setVehiclePickerOpen(false)
                  setSelectedWorkshopVehicle(vehicle)
                }}
              >
                <div className='font-medium'>
                  {vehicle.year} {vehicle.make} {vehicle.model}
                </div>
                <div className='text-xs text-muted-foreground'>
                  {t('detail.vehicleSummary', {
                    vin: vehicle.vin || notAvailable,
                    plate: vehicle.plate || notAvailable,
                  })}
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {selectedWorkshopVehicle && (
        <StartServiceDialog
          onOpenChange={(open) => {
            if (!open) {
              setSelectedWorkshopVehicle(null)
            }
          }}
          customerId={customerId}
          vehicleId={selectedWorkshopVehicle.id}
          vehicleDescription={getVehicleDescription(selectedWorkshopVehicle)}
          onCreated={(order) => navigate(`/workshop/orders/${order.id}`)}
        />
      )}
    </>
  )
}
