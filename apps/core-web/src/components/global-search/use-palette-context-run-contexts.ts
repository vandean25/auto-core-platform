import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { useWorkOrderActionRunContext } from '@/features/actions/use-work-order-action-run-context'
import { useCustomerDeleteHandler } from '@/pages/customers/use-customer-delete-handler'

export function usePaletteContextRunContexts() {
  const { t: tCustomers } = useTranslation('customers')
  const { t: tVehicles } = useTranslation('vehicles')
  const navigate = useNavigate()
  const handleCustomerDelete = useCustomerDeleteHandler()
  const workshop = useWorkOrderActionRunContext()

  const customer = useMemo(
    () => ({ navigate, onDelete: handleCustomerDelete, t: tCustomers }),
    [handleCustomerDelete, navigate, tCustomers],
  )
  const vehicle = useMemo(() => ({ navigate, t: tVehicles }), [navigate, tVehicles])

  const estimate = useMemo(() => ({ navigate }), [navigate])

  return { workshop, customer, vehicle, estimate }
}
