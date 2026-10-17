import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useRequestPart } from '@/api/mechanic'
import { getErrorMessage } from '@/lib/error-utils'
import { EMPTY_PART_REQUEST_FORM } from '../constants'
import { validatePartRequest } from '../part-request'
import type { PartRequestForm } from '../types'

export function useRequestPartForm(taskId: string) {
  const { t } = useTranslation('workshop')
  const requestPart = useRequestPart()
  const [requestPartOpen, setRequestPartOpen] = useState(false)
  const [partForm, setPartForm] = useState<PartRequestForm>(EMPTY_PART_REQUEST_FORM)
  const [partFormError, setPartFormError] = useState('')

  const openRequestPart = () => {
    setPartForm(EMPTY_PART_REQUEST_FORM)
    setPartFormError('')
    setRequestPartOpen(true)
  }

  const handleRequestPartSubmit = async () => {
    const validationError = validatePartRequest(partForm)
    if (validationError) {
      setPartFormError(
        t(`mechanic.taskDetail.partRequest.validation.${validationError}`),
      )
      return
    }
    setPartFormError('')
    try {
      await requestPart.mutateAsync({
        taskId,
        payload: {
          itemNo: partForm.itemNo.trim(),
          description: partForm.description.trim(),
          qty: parseFloat(partForm.qty),
        },
      })
      toast.success(t('mechanic.taskDetail.partRequest.toast.submitted'))
      setPartForm(EMPTY_PART_REQUEST_FORM)
      setRequestPartOpen(false)
    } catch (error: unknown) {
      toast.error(
        getErrorMessage(error, t('mechanic.taskDetail.partRequest.toast.failed')),
      )
    }
  }

  return {
    requestPart,
    requestPartOpen,
    setRequestPartOpen,
    partForm,
    setPartForm,
    partFormError,
    openRequestPart,
    handleRequestPartSubmit,
  }
}
