import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
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
    const { t } = useTranslation('workshop')
    const { register, handleSubmit, reset, formState: { errors } } = useForm<RegisterIntakePayload>({
        defaultValues: {
            vin: defaultVin || '',
            year: new Date().getFullYear(),
        }
    })

    const mutation = useRegisterIntake()

    const onSubmit = (data: RegisterIntakePayload) => {
        data.year = Number(data.year)

        mutation.mutate(data, {
            onSuccess: () => {
                toast.success(t('quickRegister.success'))
                onOpenChange(false)
                reset()
            },
            onError: () => {
                toast.error(t('quickRegister.error'))
            }
        })
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent fullScreenOnPhone className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>{t('quickRegister.title')}</DialogTitle>
                </DialogHeader>
                <form id="quick-register-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="vin">{t('quickRegister.vin')}</Label>
                            <Input
                                id="vin"
                                aria-invalid={Boolean(errors.vin)}
                                aria-describedby={errors.vin ? 'vin-error' : undefined}
                                {...register('vin', { required: true })}
                            />
                            {errors.vin && <span id="vin-error" className="text-red-500 text-xs">{t('quickRegister.required')}</span>}
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="plate">{t('quickRegister.plate')}</Label>
                            <Input
                                id="plate"
                                aria-invalid={Boolean(errors.plate)}
                                aria-describedby={errors.plate ? 'plate-error' : undefined}
                                {...register('plate', { required: true })}
                            />
                            {errors.plate && <span id="plate-error" className="text-red-500 text-xs">{t('quickRegister.required')}</span>}
                        </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                         <div className="space-y-2">
                            <Label htmlFor="make">{t('quickRegister.make')}</Label>
                            <Input
                                id="make"
                                aria-invalid={Boolean(errors.make)}
                                aria-describedby={errors.make ? 'make-error' : undefined}
                                {...register('make', { required: true })}
                            />
                            {errors.make && <span id="make-error" className="text-red-500 text-xs">{t('quickRegister.required')}</span>}
                        </div>
                         <div className="space-y-2">
                            <Label htmlFor="model">{t('quickRegister.model')}</Label>
                            <Input
                                id="model"
                                aria-invalid={Boolean(errors.model)}
                                aria-describedby={errors.model ? 'model-error' : undefined}
                                {...register('model', { required: true })}
                            />
                            {errors.model && <span id="model-error" className="text-red-500 text-xs">{t('quickRegister.required')}</span>}
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="year">{t('quickRegister.year')}</Label>
                        <Input
                            id="year"
                            type="number"
                            aria-invalid={Boolean(errors.year)}
                            aria-describedby={errors.year ? 'year-error' : undefined}
                            {...register('year', { required: true, min: 1900 })}
                        />
                        {errors.year && <span id="year-error" className="text-red-500 text-xs">{t('quickRegister.yearInvalid')}</span>}
                    </div>

                    <div className="pt-2 border-t">
                        <h3 className="text-sm font-medium mb-2">{t('quickRegister.newCustomer')}</h3>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="firstName">{t('quickRegister.firstName')}</Label>
                                <Input
                                    id="firstName"
                                    aria-invalid={Boolean(errors.firstName)}
                                    aria-describedby={errors.firstName ? 'firstName-error' : undefined}
                                    {...register('firstName', { required: true })}
                                />
                                {errors.firstName && <span id="firstName-error" className="text-red-500 text-xs">{t('quickRegister.required')}</span>}
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="lastName">{t('quickRegister.lastName')}</Label>
                                <Input
                                    id="lastName"
                                    aria-invalid={Boolean(errors.lastName)}
                                    aria-describedby={errors.lastName ? 'lastName-error' : undefined}
                                    {...register('lastName', { required: true })}
                                />
                                {errors.lastName && <span id="lastName-error" className="text-red-500 text-xs">{t('quickRegister.required')}</span>}
                            </div>
                        </div>
                         <div className="space-y-2 mt-2">
                            <Label htmlFor="email">{t('quickRegister.email')}</Label>
                            <Input id="email" type="email" {...register('email')} />
                        </div>
                        <div className="space-y-2 mt-2">
                            <Label htmlFor="phone">{t('quickRegister.phone')}</Label>
                            <Input id="phone" type="tel" autoComplete="tel" {...register('phone')} />
                        </div>
                    </div>

                </form>
                <DialogFooter>
                    <Button type="submit" form="quick-register-form" disabled={mutation.isPending}>
                        {mutation.isPending ? t('quickRegister.registering') : t('quickRegister.register')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
