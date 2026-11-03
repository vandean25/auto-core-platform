import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { usePdfDownload } from '@/hooks/usePdfDownload'
import { useWorkOrderActionRunContext } from '@/features/actions/use-work-order-action-run-context'
import { useCustomerDeleteHandler } from '@/pages/customers/use-customer-delete-handler'

export function usePaletteContextRunContexts() {
  const { t: tCustomers } = useTranslation('customers')
  const { t: tVehicles } = useTranslation('vehicles')
  const { t: tFinance } = useTranslation('finance')
  const navigate = useNavigate()
  const handleCustomerDelete = useCustomerDeleteHandler()
  const workshop = useWorkOrderActionRunContext()
  const creditNotePdf = usePdfDownload()

  const customer = useMemo(
    () => ({ navigate, onDelete: handleCustomerDelete, t: tCustomers }),
    [handleCustomerDelete, navigate, tCustomers],
  )
  const vehicle = useMemo(() => ({ navigate, t: tVehicles }), [navigate, tVehicles])

  const estimate = useMemo(() => ({ navigate }), [navigate])
  const tyreSet = useMemo(() => ({ navigate }), [navigate])
  const creditNote = useMemo(
    () => ({ t: tFinance, generateAndDownload: creditNotePdf.download }),
    [creditNotePdf.download, tFinance],
  )

  return { workshop, customer, vehicle, estimate, tyreSet, creditNote }
}
