import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { useCreateVehicle, useUpdateVehicle } from '@/api/vehicles'
import type { components } from '@/api/generated/openapi'
import { useSubmitOnce } from '@/features/interaction/use-submit-once'

type CreateVehicleDto = components['schemas']['CreateVehicleDto']

type Options = {
    vehicleId?: string
    isOpen: boolean
    /** List create: hands the payload over (once per opening) and the caller shows a pending row. */
    onCreate?: (payload: CreateVehicleDto) => void
    /** Closes the dialog and clears the form. */
    finish: () => void
}

/** Submit flow of the vehicle dialog: edit and create wait for the server, list create goes behind a pending row. */
export function useVehicleDialogSubmit({ vehicleId, isOpen, onCreate, finish }: Options) {
    const { t } = useTranslation('vehicles')
    const createMutation = useCreateVehicle()
    const updateMutation = useUpdateVehicle()
    const claimSubmit = useSubmitOnce(isOpen)

    const save = async (payload: CreateVehicleDto) => {
        if (vehicleId) {
            await updateMutation.mutateAsync({ id: vehicleId, data: payload })
            toast.success(t('dialog.updated'))
            return
        }
        await createMutation.mutateAsync(payload)
        toast.success(t('dialog.created'))
    }

    const submit = async (payload: CreateVehicleDto) => {
        if (!vehicleId && onCreate) {
            if (claimSubmit()) {
                onCreate(payload)
                finish()
            }
            return
        }
        try {
            await save(payload)
            finish()
        } catch {
            toast.error(t('dialog.saveFailed'))
        }
    }

    return { submit, isPending: createMutation.isPending || updateMutation.isPending }
}
