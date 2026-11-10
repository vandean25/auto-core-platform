import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { usePdfDownload } from '@/hooks/usePdfDownload'
import { useWorkOrderActionRunContext } from '@/features/actions/use-work-order-action-run-context'
import { useCustomerDeleteHandler } from '@/pages/customers/use-customer-delete-handler'
import { useSalesOrderDeleteHandler } from '@/pages/sales-orders/use-sales-order-delete-handler'

export function usePaletteContextRunContexts() {
  const { t: tCustomers } = useTranslation('customers')
  const { t: tVehicles } = useTranslation('vehicles')
  const { t: tFinance } = useTranslation('finance')
  const { t: tSales } = useTranslation('sales')
  const navigate = useNavigate()
  const handleCustomerDelete = useCustomerDeleteHandler()
  const handleSalesOrderDelete = useSalesOrderDeleteHandler({
    onDeleted: () => navigate(APP_ROUTE_PATHS.salesOrders),
  })
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
  const salesOrder = useMemo(
    () => ({ navigate, onDelete: handleSalesOrderDelete, t: tSales }),
    [handleSalesOrderDelete, navigate, tSales],
  )

  return { workshop, customer, vehicle, estimate, tyreSet, creditNote, salesOrder }
}
