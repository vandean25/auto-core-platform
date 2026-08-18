import { useState } from 'react'
import { toast } from 'sonner'
import { useRequestPart } from '@/api/mechanic'
import { getErrorMessage } from '@/lib/error-utils'
import { EMPTY_PART_REQUEST_FORM } from '../constants'
import { validatePartRequest } from '../part-request'
import type { PartRequestForm } from '../types'

export function useRequestPartForm(taskId: string) {
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
      setPartFormError(validationError)
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
      toast.success('Part request submitted')
      setPartForm(EMPTY_PART_REQUEST_FORM)
      setRequestPartOpen(false)
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to request part'))
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
