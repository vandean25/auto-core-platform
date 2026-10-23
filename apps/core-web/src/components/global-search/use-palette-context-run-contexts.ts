import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { useGenerateWorkshopPdf } from '@/api/workshop'
import { useCustomerDeleteHandler } from '@/pages/customers/use-customer-delete-handler'

export function usePaletteContextRunContexts() {
  const { t: tWorkshop } = useTranslation('workshop')
  const { t: tCustomers } = useTranslation('customers')
  const { t: tVehicles } = useTranslation('vehicles')
  const navigate = useNavigate()
  const generatePdf = useGenerateWorkshopPdf()
  const handleCustomerDelete = useCustomerDeleteHandler()

  const workshop = useMemo(
    () => ({ navigate, generatePdf, t: tWorkshop }),
    [generatePdf, navigate, tWorkshop],
  )
  const customer = useMemo(
    () => ({ navigate, onDelete: handleCustomerDelete, t: tCustomers }),
    [handleCustomerDelete, navigate, tCustomers],
  )
  const vehicle = useMemo(() => ({ navigate, t: tVehicles }), [navigate, tVehicles])

  return { workshop, customer, vehicle }
}
