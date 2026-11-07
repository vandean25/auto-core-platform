import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import type { UseFormSetError } from 'react-hook-form'

import { useCreateCustomer, useUpdateCustomer } from '@/api/customers'
import type { Customer } from '@/api/types'
import { useSubmitOnce } from '@/features/interaction/use-submit-once'
import { toastSuccessWithOpen } from '@/lib/toast-actions'
import { buildCustomerPayload, markRefusedFields } from './customer-submit'

type Options = {
    customer?: Customer
    isOpen: boolean
    /** List create: hands the payload over (once per opening) and the caller shows a pending row. */
    onCreate?: (payload: Partial<Customer>) => void
    fieldNames: readonly string[]
    setError: UseFormSetError<Partial<Customer>>
    /** Closes the dialog and clears the form. */
    finish: () => void
}

/** Submit flow of the customer dialog: edit and create wait for the server, list create goes behind a pending row. */
export function useCustomerDialogSubmit({ customer, isOpen, onCreate, fieldNames, setError, finish }: Options) {
    const { t } = useTranslation('customers')
    const navigate = useNavigate()
    const createMutation = useCreateCustomer()
    const updateMutation = useUpdateCustomer()
    const claimSubmit = useSubmitOnce(isOpen)

    const save = async (payload: Partial<Customer>) => {
        if (customer) {
            await updateMutation.mutateAsync({ id: customer.id, data: payload })
            toast.success(t('dialog.updated'))
            return
        }
        const created = await createMutation.mutateAsync(payload)
        toastSuccessWithOpen(t('dialog.created'), () => navigate(`/customers/${created.id}`))
    }

    const onSubmit = async (formData: Partial<Customer>) => {
        const payload = buildCustomerPayload(formData, customer)
        if (!customer && onCreate) {
            if (claimSubmit()) {
                onCreate(payload)
                finish()
            }
            return
        }
        try {
            await save(payload)
            finish()
        } catch (error) {
            // A refused field is marked on the field itself; the toast then only points at it.
            const marked = markRefusedFields(error, fieldNames, setError, t)
            toast.error(t(marked > 0 ? 'dialog.checkFields' : 'dialog.saveFailed'))
        }
    }

    return { onSubmit, isPending: createMutation.isPending || updateMutation.isPending }
}
