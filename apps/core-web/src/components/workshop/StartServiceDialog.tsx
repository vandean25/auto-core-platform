import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { useCreateWorkshopOrder } from '../../api/workshop'
import type { CreateWorkshopOrderPayload } from '../../api/types'
import { toast } from 'sonner'

interface StartServiceDialogProps {
    open?: boolean
    onOpenChange: (open: boolean) => void
    customerId: string
    vehicleId: string
    vehicleDescription: string
    onCreated?: (order: { id: string }) => void
}

export function StartServiceDialog({
    open = true,
    onOpenChange,
    customerId,
    vehicleId,
    vehicleDescription,
    onCreated,
}: StartServiceDialogProps) {
    const { t } = useTranslation('workshop')
    const { register, handleSubmit, reset, formState: { errors } } = useForm<CreateWorkshopOrderPayload>({
        defaultValues: {
            customerId,
            vehicleId,
            fuelLevel: 50,
        }
    })

    const mutation = useCreateWorkshopOrder()

    const onSubmit = (data: CreateWorkshopOrderPayload) => {
        data.customerId = customerId
        data.vehicleId = vehicleId
        data.odometer = Number(data.odometer)
        data.fuelLevel = Number(data.fuelLevel)

        mutation.mutate(data, {
            onSuccess: (order) => {
                toast.success(t('startService.success'))
                onOpenChange(false)
                reset()
                onCreated?.(order)
            },
            onError: () => {
                toast.error(t('startService.error'))
            }
        })
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>{t('startService.title')}</DialogTitle>
                    <p className="text-sm text-muted-foreground">{t('startService.forVehicle', { vehicle: vehicleDescription })}</p>
                </DialogHeader>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="odometer">{t('startService.odometer')}</Label>
                        <Input
                            id="odometer"
                            type="number"
                            aria-invalid={Boolean(errors.odometer)}
                            aria-describedby={errors.odometer ? 'odometer-error' : undefined}
                            {...register('odometer', { required: true, min: 0 })}
                        />
                        {errors.odometer && <span id="odometer-error" className="text-red-500 text-xs">{t('startService.required')}</span>}
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="fuelLevel">{t('startService.fuelLevel')}</Label>
                        <Input
                            id="fuelLevel"
                            type="number"
                            aria-invalid={Boolean(errors.fuelLevel)}
                            aria-describedby={errors.fuelLevel ? 'fuelLevel-error' : undefined}
                            {...register('fuelLevel', { required: true, min: 0, max: 100 })}
                        />
                        {errors.fuelLevel && <span id="fuelLevel-error" className="text-red-500 text-xs">{t('startService.fuelRange')}</span>}
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="notes">{t('startService.notes')}</Label>
                        <textarea
                            id="notes"
                            className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base md:text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            placeholder={t('startService.notesPlaceholder')}
                            {...register('notes')}
                        />
                    </div>

                    <div className="flex justify-end pt-4">
                        <Button type="submit" disabled={mutation.isPending}>
                            {mutation.isPending ? t('startService.creating') : t('startService.submit')}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    )
}
