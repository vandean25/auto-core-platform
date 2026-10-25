import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ensureNamespaceLoaded } from '@/lib/i18n'
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
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { useCreateCustomer, useUpdateCustomer } from '@/api/customers'
import type { Customer } from '@/api/types'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { toastSuccessWithOpen } from '@/lib/toast-actions'

interface CustomerDialogProps {
    customer?: Customer
    trigger?: React.ReactNode
    open?: boolean
    onOpenChange?: (open: boolean) => void
}

const DEFAULT_CUSTOMER: Partial<Customer> = {
    type: 'PRIVATE',
    first_name: '',
    last_name: '',
    company_name: '',
    email: '',
    contact_email_ok: false,
    phone: '',
    vat_id: '',
    address_street: '',
    address_city: '',
    address_zip: '',
    address_country: 'AT',
}

export function CustomerDialog({ customer, trigger, open: controlledOpen, onOpenChange }: CustomerDialogProps) {
    const { t } = useTranslation('customers')
    useEffect(() => {
        void ensureNamespaceLoaded('customers')
    }, [])
    const [open, setOpen] = useState(false)
    const isEdit = !!customer
    const createMutation = useCreateCustomer()
    const updateMutation = useUpdateCustomer()
    const navigate = useNavigate()

    const form = useForm<Partial<Customer>>({
        defaultValues: customer || DEFAULT_CUSTOMER,
    })

    const onSubmit = async (data: Partial<Customer>) => {
        try {
            if (isEdit && customer) {
                // A changed address withdraws the advisor's confirmation (ADR-0025 §8), so the flag is not sent as true.
                const emailChanged = (data.email ?? '') !== (customer.email ?? '')
                const payload = emailChanged ? { ...data, contact_email_ok: false } : data
                await updateMutation.mutateAsync({ id: customer.id, data: payload })
                toast.success(t('dialog.updated'))
            } else {
                const created = await createMutation.mutateAsync(data)
                toastSuccessWithOpen(t('dialog.created'), () => navigate(`/customers/${created.id}`))
            }
            handleOpenChange(false)
            form.reset()
        } catch (error) {
            toast.error(t('dialog.saveFailed'))
        }
    }

    useEffect(() => {
        if (customer) {
            form.reset(customer)
        } else {
            form.reset(DEFAULT_CUSTOMER)
        }
    }, [customer, form])

    const handleOpenChange = (newOpen: boolean) => {
        setOpen(newOpen)
        onOpenChange?.(newOpen)
        if (!newOpen && !isEdit) {
            form.reset()
        }
    }

    const type = form.watch('type')

    return (
        <Dialog open={controlledOpen ?? open} onOpenChange={handleOpenChange}>
            {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
            <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                    <DialogTitle>{isEdit ? t('dialog.editTitle') : t('dialog.addTitle')}</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <FormField
                            control={form.control}
                            name="type"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t('dialog.type')}</FormLabel>
                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue placeholder={t('dialog.selectType')} />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            <SelectItem value="PRIVATE">{t('dialog.private')}</SelectItem>
                                            <SelectItem value="COMPANY">{t('dialog.company')}</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        {type === 'COMPANY' && (
                            <div className="grid grid-cols-2 gap-4">
                                <FormField
                                    control={form.control}
                                    name="company_name"
                                    render={({ field }) => (
                                        <FormItem className="col-span-2">
                                            <FormLabel>{t('dialog.companyName')}</FormLabel>
                                            <FormControl>
                                                <Input {...field} value={field.value ?? ''} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="vat_id"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t('dialog.vatId')}</FormLabel>
                                            <FormControl>
                                                <Input {...field} value={field.value ?? ''} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="first_name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t('dialog.firstName')}</FormLabel>
                                        <FormControl>
                                            <Input {...field} value={field.value ?? ''} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="last_name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t('dialog.lastName')}</FormLabel>
                                        <FormControl>
                                            <Input {...field} value={field.value ?? ''} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="email"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t('dialog.email')}</FormLabel>
                                        <FormControl>
                                            <Input type="email" {...field} value={field.value ?? ''} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="phone"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t('dialog.phone')}</FormLabel>
                                        <FormControl>
                                            <Input type="tel" autoComplete="tel" {...field} value={field.value ?? ''} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <FormField
                            control={form.control}
                            name="contact_email_ok"
                            render={({ field }) => (
                                <FormItem>
                                    <div className="flex items-start gap-2">
                                        <FormControl>
                                            <Checkbox
                                                checked={field.value === true}
                                                onCheckedChange={(checked) => field.onChange(checked === true)}
                                            />
                                        </FormControl>
                                        <FormLabel className="font-normal leading-snug">
                                            {t('dialog.contactEmailOkLabel')}
                                        </FormLabel>
                                    </div>
                                    <FormDescription>
                                        {t('dialog.contactEmailOkDescriptionEstimate')}
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <div className="space-y-4">
                            <h4 className="font-medium">{t('dialog.addressSection')}</h4>
                            <FormField
                                control={form.control}
                                name="address_street"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t('dialog.street')}</FormLabel>
                                        <FormControl>
                                            <Input {...field} value={field.value ?? ''} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <div className="grid grid-cols-3 gap-4">
                                <FormField
                                    control={form.control}
                                    name="address_zip"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t('dialog.zip')}</FormLabel>
                                            <FormControl>
                                                <Input {...field} value={field.value ?? ''} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="address_city"
                                    render={({ field }) => (
                                        <FormItem className="col-span-2">
                                            <FormLabel>{t('dialog.city')}</FormLabel>
                                            <FormControl>
                                                <Input {...field} value={field.value ?? ''} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                             <FormField
                                control={form.control}
                                name="address_country"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t('dialog.country')}</FormLabel>
                                        <FormControl>
                                            <Input {...field} value={field.value ?? ''} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="flex justify-end gap-2">
                            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                                {t('dialog.cancel')}
                            </Button>
                            <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                                {isEdit ? t('dialog.saveChanges') : t('dialog.createCustomer')}
                            </Button>
                        </div>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}
