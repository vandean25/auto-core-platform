import { useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogFooter,
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
import type { components } from '@/api/generated/openapi'
import type { Customer, Vehicle } from '@/api/types'
import { CustomerSearch } from '@/components/sales/CustomerSearch'
import {
  VehicleRegulatorySection,
  type VehicleNovaClass,
  type VehicleRegulatoryValues,
} from '@/components/vehicles/VehicleRegulatorySection'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

interface VehicleDialogProps {
    vehicle?: Vehicle & { customer?: Customer | null }
    trigger?: ReactNode
    open?: boolean
    onOpenChange?: (open: boolean) => void
}

type VehicleFormValues = Omit<components['schemas']['CreateVehicleDto'], 'customer_id'>

const DEFAULT_VEHICLE: VehicleFormValues = {
    make: '',
    model: '',
    year: new Date().getFullYear(),
    engine_code: '',
    vin: '',
    plate: '',
}

const EMPTY_REGULATORY: VehicleRegulatoryValues = {
    first_registration_date: null,
    co2_wltp_g_km: null,
    co2_nedc_g_km: null,
    typenschein_no: null,
    nova_class: null,
    emission_class: null,
}

function regulatoryFromVehicle(
    vehicle?: Vehicle & { customer?: Customer | null },
): VehicleRegulatoryValues {
    if (!vehicle) {
        return EMPTY_REGULATORY
    }
    const firstRegistration =
        typeof vehicle.first_registration_date === 'string'
            ? vehicle.first_registration_date.slice(0, 10)
            : null
    return {
        first_registration_date: firstRegistration,
        co2_wltp_g_km: vehicle.co2_wltp_g_km ?? null,
        co2_nedc_g_km: vehicle.co2_nedc_g_km ?? null,
        typenschein_no: vehicle.typenschein_no ?? null,
        nova_class: (vehicle.nova_class as VehicleNovaClass | null) ?? null,
        emission_class: vehicle.emission_class ?? null,
    }
}

export function VehicleDialog({ vehicle, trigger, open: controlledOpen, onOpenChange }: VehicleDialogProps) {
    const { t } = useTranslation(['vehicles', 'common'])
    const [open, setOpen] = useState(false)
    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(vehicle?.customer || null)
    const isEdit = !!vehicle
    const createMutation = useCreateVehicle()
    const updateMutation = useUpdateVehicle()
    const [regulatoryValues, setRegulatoryValues] = useState<VehicleRegulatoryValues>(
        () => regulatoryFromVehicle(vehicle),
    )

    const form = useForm<VehicleFormValues>({
        defaultValues: {
            make: vehicle?.make || DEFAULT_VEHICLE.make,
            model: vehicle?.model || DEFAULT_VEHICLE.model,
            year: vehicle?.year || DEFAULT_VEHICLE.year,
            engine_code: vehicle?.engine_code || DEFAULT_VEHICLE.engine_code,
            vin: vehicle?.vin || DEFAULT_VEHICLE.vin,
            plate: vehicle?.plate || DEFAULT_VEHICLE.plate,
        },
    })

    const onSubmit = async (data: VehicleFormValues) => {
        try {
            const payload: components['schemas']['CreateVehicleDto'] = {
                ...data,
                ...regulatoryValues,
                year: Number(data.year),
                customer_id: selectedCustomer?.id || null,
            }

            if (isEdit && vehicle) {
                await updateMutation.mutateAsync({ id: vehicle.id, data: payload })
                toast.success(t('vehicles:dialog.updated'))
            } else {
                await createMutation.mutateAsync(payload)
                toast.success(t('vehicles:dialog.created'))
            }
            handleOpenChange(false)
            form.reset()
            setSelectedCustomer(null)
        } catch {
            toast.error(t('vehicles:dialog.saveFailed'))
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
            setRegulatoryValues(regulatoryFromVehicle(vehicle))
        } else {
            form.reset(DEFAULT_VEHICLE)
            setSelectedCustomer(null)
            setRegulatoryValues(EMPTY_REGULATORY)
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
            <DialogContent fullScreenOnPhone className="sm:max-w-[600px]">
                <DialogHeader>
                    <DialogTitle>{isEdit ? t('vehicles:dialog.editTitle') : t('vehicles:dialog.addTitle')}</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                    <form
                        id="vehicle-dialog-form"
                        onSubmit={form.handleSubmit(onSubmit)}
                        className="space-y-4"
                    >
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <FormField
                                control={form.control}
                                name="make"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t('vehicles:dialog.make')}</FormLabel>
                                        <FormControl>
                                            <Input {...field} placeholder={t('vehicles:dialog.makePlaceholder')} required />
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
                                        <FormLabel>{t('vehicles:dialog.model')}</FormLabel>
                                        <FormControl>
                                            <Input {...field} placeholder={t('vehicles:dialog.modelPlaceholder')} required />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <FormField
                                control={form.control}
                                name="year"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t('vehicles:dialog.year')}</FormLabel>
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
                                        <FormLabel>{t('vehicles:dialog.plate')}</FormLabel>
                                        <FormControl>
                                            <Input {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <FormField
                                control={form.control}
                                name="vin"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t('vehicles:dialog.vin')}</FormLabel>
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
                                        <FormLabel>{t('vehicles:dialog.engineCode')}</FormLabel>
                                        <FormControl>
                                            <Input {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="space-y-2">
                            <FormLabel>{t('vehicles:dialog.customerOptional')}</FormLabel>
                            <CustomerSearch
                                value={selectedCustomer}
                                onChange={setSelectedCustomer}
                            />
                        </div>

                        <VehicleRegulatorySection
                            mode="form"
                            values={regulatoryValues}
                            onChange={(patch) =>
                                setRegulatoryValues((current) => ({ ...current, ...patch }))
                            }
                        />

                    </form>
                </Form>
                <DialogFooter className="max-sm:gap-2">
                    <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                        {t('common:actions.cancel')}
                    </Button>
                    <Button
                        type="submit"
                        form="vehicle-dialog-form"
                        disabled={createMutation.isPending || updateMutation.isPending}
                    >
                        {isEdit ? t('vehicles:dialog.saveChanges') : t('vehicles:dialog.create')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
