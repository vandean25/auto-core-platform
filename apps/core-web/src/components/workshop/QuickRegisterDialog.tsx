import { useForm } from 'react-hook-form'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { useRegisterIntake } from '../../api/workshop'
import type { RegisterIntakePayload } from '../../api/types'
import { toast } from 'sonner'

interface QuickRegisterDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    defaultVin?: string
}

export function QuickRegisterDialog({ open, onOpenChange, defaultVin }: QuickRegisterDialogProps) {
    const { register, handleSubmit, reset, formState: { errors } } = useForm<RegisterIntakePayload>({
        defaultValues: {
            vin: defaultVin || '',
            year: new Date().getFullYear(),
        }
    })

    const mutation = useRegisterIntake()

    const onSubmit = (data: RegisterIntakePayload) => {
        // Ensure year is number
        data.year = Number(data.year)

        mutation.mutate(data, {
            onSuccess: () => {
                toast.success('Vehicle registered successfully')
                onOpenChange(false)
                reset()
            },
            onError: () => {
                toast.error('Failed to register vehicle')
            }
        })
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Quick Register Vehicle</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="vin">VIN</Label>
                            <Input id="vin" {...register('vin', { required: true })} />
                            {errors.vin && <span className="text-red-500 text-xs">Required</span>}
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="plate">Plate</Label>
                            <Input id="plate" {...register('plate', { required: true })} />
                            {errors.plate && <span className="text-red-500 text-xs">Required</span>}
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                         <div className="space-y-2">
                            <Label htmlFor="make">Make</Label>
                            <Input id="make" {...register('make', { required: true })} />
                            {errors.make && <span className="text-red-500 text-xs">Required</span>}
                        </div>
                         <div className="space-y-2">
                            <Label htmlFor="model">Model</Label>
                            <Input id="model" {...register('model', { required: true })} />
                            {errors.model && <span className="text-red-500 text-xs">Required</span>}
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="year">Year</Label>
                        <Input id="year" type="number" {...register('year', { required: true, min: 1900 })} />
                        {errors.year && <span className="text-red-500 text-xs">Valid year required</span>}
                    </div>

                    <div className="pt-2 border-t">
                        <h3 className="text-sm font-medium mb-2">New Customer</h3>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="firstName">First Name</Label>
                                <Input id="firstName" {...register('firstName', { required: true })} />
                                {errors.firstName && <span className="text-red-500 text-xs">Required</span>}
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="lastName">Last Name</Label>
                                <Input id="lastName" {...register('lastName', { required: true })} />
                                {errors.lastName && <span className="text-red-500 text-xs">Required</span>}
                            </div>
                        </div>
                         <div className="space-y-2 mt-2">
                            <Label htmlFor="email">Email</Label>
                            <Input id="email" type="email" {...register('email')} />
                        </div>
                        <div className="space-y-2 mt-2">
                            <Label htmlFor="phone">Phone</Label>
                            <Input id="phone" {...register('phone')} />
                        </div>
                    </div>

                    <div className="flex justify-end pt-4">
                        <Button type="submit" disabled={mutation.isPending}>
                            {mutation.isPending ? 'Registering...' : 'Register'}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    )
}
