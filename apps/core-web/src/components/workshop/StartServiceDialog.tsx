import { useForm } from 'react-hook-form'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { useCreateWorkshopOrder } from '../../api/workshop'
import type { CreateWorkshopOrderPayload } from '../../api/types'
import { toast } from 'sonner'

interface StartServiceDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    customerId: string
    vehicleId: string
    vehicleDescription: string
    onCreated?: (order: { id: string }) => void
}

export function StartServiceDialog({
    open,
    onOpenChange,
    customerId,
    vehicleId,
    vehicleDescription,
    onCreated,
}: StartServiceDialogProps) {
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
                toast.success('Service started')
                onOpenChange(false)
                reset()
                onCreated?.(order)
            },
            onError: () => {
                toast.error('Failed to start service')
            }
        })
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Start Service</DialogTitle>
                    <p className="text-sm text-muted-foreground">For {vehicleDescription}</p>
                </DialogHeader>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="odometer">Odometer (km)</Label>
                        <Input id="odometer" type="number" {...register('odometer', { required: true, min: 0 })} />
                        {errors.odometer && <span className="text-red-500 text-xs">Required</span>}
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="fuelLevel">Fuel Level (%)</Label>
                        <Input id="fuelLevel" type="number" {...register('fuelLevel', { required: true, min: 0, max: 100 })} />
                        {errors.fuelLevel && <span className="text-red-500 text-xs">0-100 required</span>}
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="notes">Intake Notes</Label>
                        <textarea
                            id="notes"
                            className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            placeholder="Customer Description of Issue"
                            {...register('notes')}
                        />
                    </div>

                    <div className="flex justify-end pt-4">
                        <Button type="submit" disabled={mutation.isPending}>
                            {mutation.isPending ? 'Creating Order...' : 'Start Service'}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    )
}
