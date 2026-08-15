import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatusBadge } from '@/components/status/StatusBadge'
import { CustomerSearch } from '@/components/sales/CustomerSearch'
import { useVendors } from '@/api/vendors'
import {
  useCreateVehiclePurchase,
  useReceiveVehiclePurchase,
  useUpdateVehiclePurchase,
  useVehiclePurchase,
  type CreateVehiclePurchaseInput,
} from '@/api/vehicle-stock'
import type { Customer } from '@/api/types'
import { getErrorMessage } from '@/lib/error-utils'

const AUTO_SAVE_DEBOUNCE_MS = 750

type PurchaseForm = {
  seller_type: 'VENDOR' | 'CUSTOMER'
  vendor_id: string
  customer_id: string
  vin: string
  make: string
  model: string
  year: string
  plate: string
  color: string
  mileage: string
  purchase_price: string
}

const emptyForm: PurchaseForm = {
  seller_type: 'VENDOR',
  vendor_id: '',
  customer_id: '',
  vin: '',
  make: '',
  model: '',
  year: String(new Date().getFullYear()),
  plate: '',
  color: '',
  mileage: '',
  purchase_price: '',
}

function toPayload(form: PurchaseForm): CreateVehiclePurchaseInput | null {
  const year = Number(form.year)
  const purchase_price = Number(form.purchase_price)
  if (!form.vin || !form.make || !form.model || !year || !purchase_price) {
    return null
  }
  if (form.seller_type === 'VENDOR' && !form.vendor_id) return null
  if (form.seller_type === 'CUSTOMER' && !form.customer_id) return null
  return {
    seller_type: form.seller_type,
    vendor_id: form.seller_type === 'VENDOR' ? form.vendor_id : undefined,
    customer_id: form.seller_type === 'CUSTOMER' ? form.customer_id : undefined,
    vin: form.vin,
    make: form.make,
    model: form.model,
    year,
    plate: form.plate || undefined,
    color: form.color || undefined,
    mileage: form.mileage ? Number(form.mileage) : undefined,
    purchase_price,
  }
}

export default function VehiclePurchasePage() {
  const { id = 'new' } = useParams()
  const navigate = useNavigate()
  const isNew = id === 'new'
  const { data: existing } = useVehiclePurchase(id)
  const createPurchase = useCreateVehiclePurchase()
  const [purchaseId, setPurchaseId] = useState(isNew ? '' : id)
  const updatePurchase = useUpdateVehiclePurchase(purchaseId)
  const receivePurchase = useReceiveVehiclePurchase()
  const { data: vendorsResponse } = useVendors({ page: 1, pageSize: 50, filters: [] })
  const [form, setForm] = useState<PurchaseForm>(emptyForm)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const lastSavedSerialized = useRef<string | null>(null)
  const createPurchaseRef = useRef(createPurchase)
  const updatePurchaseRef = useRef(updatePurchase)
  createPurchaseRef.current = createPurchase
  updatePurchaseRef.current = updatePurchase

  useEffect(() => {
    if (!existing) return
    const nextForm: PurchaseForm = {
      seller_type: existing.seller_type,
      vendor_id: existing.vendor_id ?? '',
      customer_id: existing.customer_id ?? '',
      vin: existing.vin,
      make: existing.make,
      model: existing.model,
      year: String(existing.year),
      plate: existing.plate ?? '',
      color: existing.color ?? '',
      mileage: existing.mileage != null ? String(existing.mileage) : '',
      purchase_price: String(existing.purchase_price),
    }
    setPurchaseId(existing.id)
    setForm(nextForm)
    lastSavedSerialized.current = JSON.stringify(toPayload(nextForm))
    if (existing.customer) {
      setCustomer({
        id: existing.customer.id,
        type: existing.customer.type,
        first_name: existing.customer.first_name,
        last_name: existing.customer.last_name,
        company_name: existing.customer.company_name ?? undefined,
        email: existing.customer.email ?? '',
      })
    }
  }, [existing])

  const payload = useMemo(() => toPayload(form), [form])
  const isDraft = !existing || existing.status === 'DRAFT'

  useEffect(() => {
    if (!isDraft || !payload) return
    const serialized = JSON.stringify(payload)
    if (serialized === lastSavedSerialized.current) return
    const handle = window.setTimeout(() => {
      void (async () => {
        setSaveStatus('saving')
        try {
          if (!purchaseId) {
            const created = await createPurchaseRef.current.mutateAsync(payload)
            setPurchaseId(created.id)
            lastSavedSerialized.current = serialized
            navigate(`/vehicle-stock/purchases/${created.id}`, { replace: true })
          } else {
            await updatePurchaseRef.current.mutateAsync(payload)
            lastSavedSerialized.current = serialized
          }
          setSaveStatus('saved')
        } catch (error) {
          setSaveStatus('error')
          toast.error(getErrorMessage(error, 'Failed to save purchase'))
        }
      })()
    }, AUTO_SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(handle)
  }, [payload, isDraft, purchaseId, navigate])

  const receive = async () => {
    if (!purchaseId) return
    try {
      const received = await receivePurchase.mutateAsync(purchaseId)
      toast.success('Vehicle received into stock')
      if (received.vehicle_id) {
        navigate(`/vehicle-stock/${received.vehicle_id}`)
      }
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to receive vehicle'))
    }
  }

  const vendors = vendorsResponse?.data ?? []

  return (
    <div className="w-full max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/vehicle-stock')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Vehicle purchase</h1>
            <p className="text-slate-500">Buy a used car from a vendor or a private seller.</p>
          </div>
          {existing ? <StatusBadge status={existing.status} /> : null}
        </div>
        <div className="flex items-center gap-3">
          {saveStatus === 'saving' && <span className="text-sm text-slate-500">Saving...</span>}
          {saveStatus === 'saved' && <span className="text-sm text-emerald-600">Saved</span>}
          {saveStatus === 'error' && <span className="text-sm text-rose-600">Save failed</span>}
          <Button disabled={!purchaseId || !isDraft} onClick={() => void receive()}>
            Receive
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-slate-500">Seller type</span>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
            disabled={!isDraft}
            value={form.seller_type}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                seller_type: event.target.value as PurchaseForm['seller_type'],
              }))
            }
          >
            <option value="VENDOR">Vendor</option>
            <option value="CUSTOMER">Private seller</option>
          </select>
        </label>
        {form.seller_type === 'VENDOR' ? (
          <label className="space-y-1 text-sm">
            <span className="text-slate-500">Vendor</span>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              disabled={!isDraft}
              value={form.vendor_id}
              onChange={(event) =>
                setForm((current) => ({ ...current, vendor_id: event.target.value }))
              }
            >
              <option value="">Select vendor...</option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="space-y-1 text-sm">
            <span className="text-slate-500">Private seller</span>
            <CustomerSearch
              value={customer}
              onChange={(next) => {
                setCustomer(next)
                setForm((current) => ({ ...current, customer_id: next?.id ?? '' }))
              }}
            />
          </div>
        )}
        <label className="space-y-1 text-sm">
          <span className="text-slate-500">VIN</span>
          <Input
            disabled={!isDraft}
            value={form.vin}
            onChange={(event) => setForm((current) => ({ ...current, vin: event.target.value }))}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-500">Make</span>
          <Input
            disabled={!isDraft}
            value={form.make}
            onChange={(event) => setForm((current) => ({ ...current, make: event.target.value }))}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-500">Model</span>
          <Input
            disabled={!isDraft}
            value={form.model}
            onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-500">Year</span>
          <Input
            disabled={!isDraft}
            type="number"
            value={form.year}
            onChange={(event) => setForm((current) => ({ ...current, year: event.target.value }))}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-500">Plate</span>
          <Input
            disabled={!isDraft}
            value={form.plate}
            onChange={(event) => setForm((current) => ({ ...current, plate: event.target.value }))}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-500">Color</span>
          <Input
            disabled={!isDraft}
            value={form.color}
            onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-500">Mileage</span>
          <Input
            disabled={!isDraft}
            type="number"
            value={form.mileage}
            onChange={(event) => setForm((current) => ({ ...current, mileage: event.target.value }))}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-500">Purchase price</span>
          <Input
            disabled={!isDraft}
            type="number"
            value={form.purchase_price}
            onChange={(event) =>
              setForm((current) => ({ ...current, purchase_price: event.target.value }))
            }
          />
        </label>
      </div>
    </div>
  )
}
