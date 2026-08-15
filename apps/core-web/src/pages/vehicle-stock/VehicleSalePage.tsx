import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatusBadge } from '@/components/status/StatusBadge'
import { CustomerSearch } from '@/components/sales/CustomerSearch'
import {
  useCreateVehicleSale,
  useFinalizeVehicleSale,
  useUpdateVehicleSale,
  useVehicleSale,
  useVehicleStockDetail,
} from '@/api/vehicle-stock'
import type { Customer } from '@/api/types'
import { formatCurrency } from '@/lib/utils'
import { getErrorMessage } from '@/lib/error-utils'

const AUTO_SAVE_DEBOUNCE_MS = 750

export default function VehicleSalePage() {
  const { id = 'new' } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const isNew = id === 'new'
  const vehicleIdFromQuery = searchParams.get('vehicleId') ?? ''
  const { data: existing } = useVehicleSale(id)
  const vehicleId = existing?.vehicle_id || vehicleIdFromQuery
  const { data: vehicle } = useVehicleStockDetail(vehicleId)
  const createSale = useCreateVehicleSale()
  const updateSale = useUpdateVehicleSale(isNew ? '' : id)
  const finalizeSale = useFinalizeVehicleSale()
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [salePrice, setSalePrice] = useState('')
  const [saleId, setSaleId] = useState(isNew ? '' : id)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const skipNextSave = useRef(true)

  useEffect(() => {
    if (!existing) return
    skipNextSave.current = true
    setSaleId(existing.id)
    setSalePrice(String(existing.sale_price))
  }, [existing])

  const isDraft = !existing || existing.status === 'DRAFT'
  const customerId = customer?.id || existing?.customer_id || ''
  const priceNumber = Number(salePrice)

  useEffect(() => {
    if (!isDraft || !vehicleId || !customerId || !priceNumber) return
    if (skipNextSave.current) {
      skipNextSave.current = false
      return
    }
    const handle = window.setTimeout(() => {
      void (async () => {
        setSaveStatus('saving')
        try {
          if (!saleId) {
            const created = await createSale.mutateAsync({
              vehicle_id: vehicleId,
              customer_id: customerId,
              sale_price: priceNumber,
            })
            setSaleId(created.id)
            navigate(`/vehicle-stock/sales/${created.id}`, { replace: true })
          } else {
            await updateSale.mutateAsync({
              customer_id: customerId,
              sale_price: priceNumber,
            })
          }
          setSaveStatus('saved')
        } catch (error) {
          setSaveStatus('error')
          toast.error(getErrorMessage(error, 'Failed to save sale'))
        }
      })()
    }, AUTO_SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(handle)
  }, [
    isDraft,
    vehicleId,
    customerId,
    priceNumber,
    saleId,
    createSale,
    updateSale,
    navigate,
  ])

  const finalize = async () => {
    if (!saleId) return
    try {
      const result = await finalizeSale.mutateAsync(saleId)
      toast.success('Sale invoiced')
      if (result.invoice?.id) {
        navigate(`/sales/invoices/${result.invoice.id}`)
      } else {
        navigate('/vehicle-stock')
      }
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to finalize sale'))
    }
  }

  const vatPreview = existing?.margin_vat_preview
  const costPreview = existing?.cost_basis_preview ?? vehicle?.cost_basis

  return (
    <div className="w-full max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(vehicleId ? `/vehicle-stock/${vehicleId}` : '/vehicle-stock')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Vehicle sale</h1>
            <p className="text-slate-500">
              {vehicle
                ? `${vehicle.year} ${vehicle.make} ${vehicle.model} · Differenzbesteuerung`
                : 'Sell a used stock vehicle on the margin scheme.'}
            </p>
          </div>
          {existing ? <StatusBadge status={existing.status} /> : null}
        </div>
        <div className="flex items-center gap-3">
          {saveStatus === 'saving' && <span className="text-sm text-slate-500">Saving...</span>}
          {saveStatus === 'saved' && <span className="text-sm text-emerald-600">Saved</span>}
          {saveStatus === 'error' && <span className="text-sm text-rose-600">Save failed</span>}
          <Button disabled={!saleId || !isDraft} onClick={() => void finalize()}>
            Finalize invoice
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1 text-sm">
          <span className="text-slate-500">Buyer</span>
          <CustomerSearch value={customer} onChange={setCustomer} />
        </div>
        <label className="space-y-1 text-sm">
          <span className="text-slate-500">Sale price (gross)</span>
          <Input
            disabled={!isDraft}
            type="number"
            value={salePrice}
            onChange={(event) => setSalePrice(event.target.value)}
          />
        </label>
      </div>

      <div className="rounded-lg border p-4 grid gap-3 md:grid-cols-3">
        <div>
          <div className="text-xs text-slate-500">Cost basis</div>
          <div className="font-medium">
            {costPreview != null ? formatCurrency(costPreview) : '—'}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Margin VAT</div>
          <div className="font-medium">
            {vatPreview != null ? formatCurrency(vatPreview) : '—'}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Tax mode</div>
          <div className="font-medium">MARGIN_SCHEME</div>
        </div>
      </div>
    </div>
  )
}
