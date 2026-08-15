import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status/StatusBadge'
import { InlineEdit } from '@/components/inline-edit/InlineEdit'
import { CustomerSearch } from '@/components/sales/CustomerSearch'
import {
  usePatchVehicleStock,
  useVehicleStockDetail,
} from '@/api/vehicle-stock'
import { useCreateWorkshopOrder } from '@/api/workshop'
import { formatCurrency } from '@/lib/utils'
import { getErrorMessage } from '@/lib/error-utils'
import type { Customer } from '@/api/types'

export default function VehicleStockDetail() {
  const { vehicleId = '' } = useParams()
  const navigate = useNavigate()
  const { data: vehicle, isLoading } = useVehicleStockDetail(vehicleId)
  const patchStock = usePatchVehicleStock(vehicleId)
  const createPrep = useCreateWorkshopOrder()

  if (isLoading || !vehicle) {
    return (
      <div className="w-full max-w-7xl mx-auto p-6">
        <p className="text-slate-500">Loading stock vehicle...</p>
      </div>
    )
  }

  const canSell =
    vehicle.stock_status === 'IN_STOCK' || vehicle.stock_status === 'RESERVED'
  const canPrep = canSell

  const reservedCustomer = vehicle.reserved_for_customer
    ? ({
        id: vehicle.reserved_for_customer.id,
        first_name: vehicle.reserved_for_customer.first_name,
        last_name: vehicle.reserved_for_customer.last_name,
        company_name: vehicle.reserved_for_customer.company_name,
        type: vehicle.reserved_for_customer.company_name ? 'COMPANY' : 'PRIVATE',
        email: '',
      } as Customer)
    : null

  const saveField = async (patch: Parameters<typeof patchStock.mutateAsync>[0]) => {
    try {
      await patchStock.mutateAsync(patch)
      toast.success('Saved')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to save'))
    }
  }

  const startPrep = async () => {
    try {
      const order = await createPrep.mutateAsync({
        vehicleId,
        purpose: 'STOCK_PREP',
        odometer: vehicle.mileage ?? 0,
        fuelLevel: 50,
      })
      navigate(`/workshop/orders/${order.id}`)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to start stock prep'))
    }
  }

  return (
    <div className="w-full max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/vehicle-stock')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {vehicle.year} {vehicle.make} {vehicle.model}
            </h1>
            <p className="text-slate-500">{vehicle.vin || 'No VIN'}</p>
          </div>
          {vehicle.stock_status ? <StatusBadge status={vehicle.stock_status} /> : null}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={!canPrep} onClick={() => void startPrep()}>
            Stock prep
          </Button>
          <Button
            disabled={!canSell}
            onClick={() => navigate(`/vehicle-stock/sales/new?vehicleId=${vehicleId}`)}
          >
            Sell
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-lg border p-4 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Details</h2>
          <div>
            <div className="text-xs text-slate-500">Cost basis</div>
            <div className="font-medium">{formatCurrency(vehicle.cost_basis)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Mileage</div>
            <InlineEdit
              value={vehicle.mileage != null ? String(vehicle.mileage) : ''}
              placeholder="Mileage"
              onSave={(next) => saveField({ mileage: Number(next) || 0 })}
            />
          </div>
          <div>
            <div className="text-xs text-slate-500">Color</div>
            <InlineEdit
              value={vehicle.color}
              placeholder="Color"
              onSave={(next) => saveField({ color: next })}
            />
          </div>
          <div>
            <div className="text-xs text-slate-500">Key number</div>
            <InlineEdit
              value={vehicle.key_number}
              placeholder="Key number"
              onSave={(next) => saveField({ key_number: next })}
            />
          </div>
          <div>
            <div className="text-xs text-slate-500">Registration papers</div>
            <InlineEdit
              value={vehicle.registration_certificate_no}
              placeholder="Certificate no."
              onSave={(next) => saveField({ registration_certificate_no: next })}
            />
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Reserved for</div>
            <CustomerSearch
              value={reservedCustomer}
              onChange={(customer) => {
                void saveField({ reserved_for_customer_id: customer?.id ?? null })
              }}
            />
          </div>
        </div>

        <div className="rounded-lg border p-4 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Ledger</h2>
          {vehicle.ledger_entries.length === 0 ? (
            <p className="text-slate-500 text-sm">No ledger entries yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-1">Type</th>
                  <th className="py-1 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {vehicle.ledger_entries.map((entry) => (
                  <tr key={entry.id} className="border-t">
                    <td className="py-2">
                      <StatusBadge status={entry.entry_type} />
                    </td>
                    <td className="py-2 text-right">{formatCurrency(entry.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
