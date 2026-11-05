import { useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type { UseFormReturn } from 'react-hook-form'
import { useCreateSalesOrder, useUpdateSalesOrder } from '@/api/sales-orders'
import { useDebouncedAutoSave } from '@/hooks/useDebouncedAutoSave'
import type { SalesOrderForm, SalesOrderPayload } from './sales-order-form'

/** Debounced draft autosave for the sales order form, plus the "done" navigation. */
export function useSalesOrderDraft(
  form: UseFormReturn<SalesOrderForm>,
  toPayload: (data: SalesOrderForm) => SalesOrderPayload,
) {
  const navigate = useNavigate()
  const createMutation = useCreateSalesOrder()
  const updateMutation = useUpdateSalesOrder()
  const orderIdRef = useRef<string | null>(null)
  const lastSavedRef = useRef<string | null>(null)
  const createMutationRef = useRef(createMutation)
  const updateMutationRef = useRef(updateMutation)

  useEffect(() => {
    createMutationRef.current = createMutation
    updateMutationRef.current = updateMutation
  })

  const customerId = form.watch('customer_id')
  const notes = form.watch('notes')
  const items = form.watch('items')

  const saveDraft = useCallback(async (snapshot: SalesOrderForm, signal: AbortSignal) => {
    const payload = toPayload(snapshot)
    const serialized = JSON.stringify(payload)
    if (serialized === lastSavedRef.current) return

    if (orderIdRef.current) {
      await updateMutationRef.current.mutateAsync({
        id: orderIdRef.current,
        data: payload,
        signal,
      })
    } else {
      const created = await createMutationRef.current.mutateAsync({ ...payload, signal })
      orderIdRef.current = created.id
    }
    lastSavedRef.current = serialized
  }, [toPayload])

  const { saveStatus, triggerAutoSave } = useDebouncedAutoSave<SalesOrderForm>({
    save: saveDraft,
    shouldSave: (snapshot) => Boolean(snapshot.customer_id),
  })

  useEffect(() => {
    if (!form.formState.isDirty) return
    triggerAutoSave({
      customer_id: customerId,
      notes,
      items,
    })
  }, [customerId, notes, items, form.formState.isDirty, triggerAutoSave])

  const finish = async () => {
    await triggerAutoSave(
      {
        customer_id: customerId,
        notes,
        items,
      },
      { immediate: true },
    )
    if (orderIdRef.current) {
      navigate(`/sales-orders/${orderIdRef.current}`)
      return
    }
    navigate('/sales-orders')
  }

  return { saveStatus, finish }
}
