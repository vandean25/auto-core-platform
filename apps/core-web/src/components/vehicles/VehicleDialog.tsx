import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog'
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { useCreateVehicle, useUpdateVehicle } from '@/api/vehicles'
import type { Customer, Vehicle } from '@/api/types'
import { CustomerSearch } from '@/components/sales/CustomerSearch'
import { toast } from 'sonner'

interface VehicleDialogProps {
    vehicle?: Vehicle & { customer?: Customer | null }
    trigger?: React.ReactNode
    open?: boolean
    onOpenChange?: (open: boolean) => void
}

const DEFAULT_VEHICLE = {
    make: '',
    model: '',
    year: new Date().getFullYear(),
    engine_code: '',
    vin: '',
    plate: '',
}

export function VehicleDialog({ vehicle, trigger, open: controlledOpen, onOpenChange }: VehicleDialogProps) {
    const [open, setOpen] = useState(false)
    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(vehicle?.customer || null)
    const isEdit = !!vehicle
    const createMutation = useCreateVehicle()
    const updateMutation = useUpdateVehicle()

    const form = useForm({
        defaultValues: {
            make: vehicle?.make || DEFAULT_VEHICLE.make,
            model: vehicle?.model || DEFAULT_VEHICLE.model,
            year: vehicle?.year || DEFAULT_VEHICLE.year,
            engine_code: vehicle?.engine_code || DEFAULT_VEHICLE.engine_code,
            vin: vehicle?.vin || DEFAULT_VEHICLE.vin,
            plate: vehicle?.plate || DEFAULT_VEHICLE.plate,
        },
    })

    const onSubmit = async (data: any) => {
        try {
            const payload = {
                ...data,
                year: Number(data.year),
                customer_id: selectedCustomer?.id || null,
            }

            if (isEdit && vehicle) {
                await updateMutation.mutateAsync({ id: vehicle.id, data: payload })
                toast.success('Vehicle updated')
            } else {
                await createMutation.mutateAsync(payload)
                toast.success('Vehicle created')
            }
            handleOpenChange(false)
            form.reset()
            setSelectedCustomer(null)
        } catch (error) {
            toast.error('Failed to save vehicle')
        }
    }

    useEffect(() => {
        if (vehicle) {
            form.reset({
                make: vehicle.make,
                model: vehicle.model,
                year: vehicle.year,
                engine_code: vehicle.engine_code || '',
                vin: vehicle.vin || '',
                plate: vehicle.plate || '',
            })
            setSelectedCustomer(vehicle.customer || null)
        } else {
            form.reset(DEFAULT_VEHICLE)
            setSelectedCustomer(null)
        }
    }, [vehicle, form])

    const handleOpenChange = (newOpen: boolean) => {
        setOpen(newOpen)
        onOpenChange?.(newOpen)
        if (!newOpen && !isEdit) {
            form.reset()
            setSelectedCustomer(null)
        }
    }

    return (
        <Dialog open={controlledOpen ?? open} onOpenChange={handleOpenChange}>
            {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
            <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                    <DialogTitle>{isEdit ? 'Edit Vehicle' : 'Add Vehicle'}</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="make"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Make</FormLabel>
                                        <FormControl>
                                            <Input {...field} placeholder="Toyota" required />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="model"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Model</FormLabel>
                                        <FormControl>
                                            <Input {...field} placeholder="Corolla" required />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="year"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Year</FormLabel>
                                        <FormControl>
                                            <Input type="number" min={1900} max={2100} {...field} required />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="plate"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>License Plate</FormLabel>
                                        <FormControl>
                                            <Input {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="vin"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>VIN</FormLabel>
                                        <FormControl>
                                            <Input {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="engine_code"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Engine Code</FormLabel>
                                        <FormControl>
                                            <Input {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="space-y-2">
                            <FormLabel>Customer (Optional)</FormLabel>
                            <CustomerSearch
                                value={selectedCustomer}
                                onChange={setSelectedCustomer}
                            />
                        </div>

                        <div className="flex justify-end gap-2 pt-4">
                            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                                {isEdit ? 'Save Changes' : 'Create Vehicle'}
                            </Button>
                        </div>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}
