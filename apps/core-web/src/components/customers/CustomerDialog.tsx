import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { ensureNamespaceLoaded } from '@/lib/i18n'
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
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { CUSTOMER_FIELD_MAX_LENGTH } from '@/constants/field-limits'
import type { Customer } from '@/api/types'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCustomerDialogSubmit } from './use-customer-dialog-submit'

interface CustomerDialogProps {
    customer?: Customer
    trigger?: React.ReactNode
    open?: boolean
    onOpenChange?: (open: boolean) => void
    /**
     * List create: the caller sends the create behind a pending row. The dialog closes at once and
     * submits only once per opening, so a double click cannot create the customer twice.
     */
    onCreate?: (payload: Partial<Customer>) => void
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

export function CustomerDialog({ customer, trigger, open: controlledOpen, onOpenChange, onCreate }: CustomerDialogProps) {
    const { t } = useTranslation('customers')
    useEffect(() => {
        void ensureNamespaceLoaded('customers')
    }, [])
    const [open, setOpen] = useState(false)
    const isEdit = !!customer

    const form = useForm<Partial<Customer>>({
        defaultValues: customer || DEFAULT_CUSTOMER,
    })

    const isOpen = controlledOpen ?? open
    const { onSubmit, isPending } = useCustomerDialogSubmit({
        customer,
        isOpen,
        onCreate,
        fieldNames: Object.keys(DEFAULT_CUSTOMER),
        setError: form.setError,
        finish: () => {
            handleOpenChange(false)
            form.reset()
        },
    })

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
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
            <DialogContent fullScreenOnPhone className="sm:max-w-[600px]">
                <DialogHeader>
                    <DialogTitle>{isEdit ? t('dialog.editTitle') : t('dialog.addTitle')}</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                    <form id="customer-dialog-form" onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <FormField
                                    control={form.control}
                                    name="company_name"
                                    render={({ field }) => (
                                        <FormItem className="sm:col-span-2">
                                            <FormLabel>{t('dialog.companyName')}</FormLabel>
                                            <FormControl>
                                                <Input {...field} value={field.value ?? ''} maxLength={CUSTOMER_FIELD_MAX_LENGTH.company_name} />
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
                                                <Input {...field} value={field.value ?? ''} maxLength={CUSTOMER_FIELD_MAX_LENGTH.vat_id} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                        )}

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <FormField
                                control={form.control}
                                name="first_name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t('dialog.firstName')}</FormLabel>
                                        <FormControl>
                                            <Input {...field} value={field.value ?? ''} maxLength={CUSTOMER_FIELD_MAX_LENGTH.first_name} />
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
                                            <Input {...field} value={field.value ?? ''} maxLength={CUSTOMER_FIELD_MAX_LENGTH.last_name} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <FormField
                                control={form.control}
                                name="email"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t('dialog.email')}</FormLabel>
                                        <FormControl>
                                            <Input type="email" {...field} value={field.value ?? ''} maxLength={CUSTOMER_FIELD_MAX_LENGTH.email} />
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
                                            <Input type="tel" autoComplete="tel" {...field} value={field.value ?? ''} maxLength={CUSTOMER_FIELD_MAX_LENGTH.phone} />
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
                                            <Input {...field} value={field.value ?? ''} maxLength={CUSTOMER_FIELD_MAX_LENGTH.address_street} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                                <FormField
                                    control={form.control}
                                    name="address_zip"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{t('dialog.zip')}</FormLabel>
                                            <FormControl>
                                                <Input {...field} value={field.value ?? ''} maxLength={CUSTOMER_FIELD_MAX_LENGTH.address_zip} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="address_city"
                                    render={({ field }) => (
                                        <FormItem className="sm:col-span-2">
                                            <FormLabel>{t('dialog.city')}</FormLabel>
                                            <FormControl>
                                                <Input {...field} value={field.value ?? ''} maxLength={CUSTOMER_FIELD_MAX_LENGTH.address_city} />
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
                                            <Input {...field} value={field.value ?? ''} maxLength={CUSTOMER_FIELD_MAX_LENGTH.address_country} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>
                    </form>
                </Form>
                <DialogFooter className="max-sm:gap-2">
                    <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                        {t('dialog.cancel')}
                    </Button>
                    <Button
                        type="submit"
                        form="customer-dialog-form"
                        disabled={isPending}
                    >
                        {isEdit ? t('dialog.saveChanges') : t('dialog.createCustomer')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
