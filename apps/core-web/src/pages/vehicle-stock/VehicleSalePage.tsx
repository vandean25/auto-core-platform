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
import { NovaPreviewPanel } from '@/components/vehicles/NovaPreviewPanel'

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
  const { mutateAsync: createSale } = useCreateVehicleSale()
  const [saleId, setSaleId] = useState(isNew ? '' : id)
  const { mutateAsync: updateSale } = useUpdateVehicleSale(saleId)
  const finalizeSale = useFinalizeVehicleSale()
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [salePrice, setSalePrice] = useState('')
  const [contractDate, setContractDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [handoverDate, setHandoverDate] = useState('')
  const [buyerIsConsumer, setBuyerIsConsumer] = useState(true)
  const [shorteningNegotiated, setShorteningNegotiated] = useState(false)
  const [warrantyNote, setWarrantyNote] = useState('')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const lastSavedSerialized = useRef<string | null>(null)

  useEffect(() => {
    if (!existing) return
    setSaleId(existing.id)
    setSalePrice(String(existing.sale_price))
    setContractDate(existing.contract_concluded_at?.slice(0, 10) ?? '')
    setHandoverDate(existing.handed_over_at?.slice(0, 10) ?? '')
    setBuyerIsConsumer(existing.buyer_is_consumer ?? existing.customer?.type === 'PRIVATE')
    setShorteningNegotiated(existing.gewaehrleistung_shortened_negotiated ?? false)
    setWarrantyNote(existing.gewaehrleistung_note ?? '')
    lastSavedSerialized.current = JSON.stringify({
      vehicle_id: existing.vehicle_id,
      customer_id: existing.customer_id,
      sale_price: Number(existing.sale_price),
      contract_concluded_at: existing.contract_concluded_at ?? null,
      handed_over_at: existing.handed_over_at ?? null,
      buyer_is_consumer: existing.buyer_is_consumer ?? existing.customer?.type === 'PRIVATE',
      gewaehrleistung_shortened_negotiated: existing.gewaehrleistung_shortened_negotiated ?? false,
      gewaehrleistung_note: existing.gewaehrleistung_note ?? null,
    })
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

  const handleCustomerChange = (nextCustomer: Customer | null) => {
    setCustomer(nextCustomer)
    if (!nextCustomer) return
    const isConsumer = nextCustomer.type === 'PRIVATE'
    setBuyerIsConsumer(isConsumer)
    if (!isConsumer) setShorteningNegotiated(false)
  }

  const isDraft = !existing || existing.status === 'DRAFT'
  const customerId = customer?.id || existing?.customer_id || ''
  const priceNumber = Number(salePrice)

  useEffect(() => {
    if (!isDraft || !vehicleId || !customerId || !priceNumber) return
    const saleFacts = {
      vehicle_id: vehicleId,
      customer_id: customerId,
      sale_price: priceNumber,
      contract_concluded_at: contractDate || null,
      handed_over_at: handoverDate || null,
      buyer_is_consumer: buyerIsConsumer,
      gewaehrleistung_shortened_negotiated: buyerIsConsumer && shorteningNegotiated,
      gewaehrleistung_note: warrantyNote || null,
    }
    const serialized = JSON.stringify(saleFacts)
    if (serialized === lastSavedSerialized.current) return
    const handle = window.setTimeout(() => {
      void (async () => {
        setSaveStatus('saving')
        try {
          if (!saleId) {
            const created = await createSale({
              ...saleFacts,
              contract_concluded_at: contractDate || undefined,
              handed_over_at: handoverDate || undefined,
              gewaehrleistung_note: warrantyNote || null,
            })
            setSaleId(created.id)
            lastSavedSerialized.current = serialized
            navigate(`/vehicle-stock/sales/${created.id}`, { replace: true })
          } else {
            await updateSale({
              customer_id: customerId,
              sale_price: priceNumber,
              contract_concluded_at: contractDate || null,
              handed_over_at: handoverDate || null,
              buyer_is_consumer: buyerIsConsumer,
              gewaehrleistung_shortened_negotiated: buyerIsConsumer && shorteningNegotiated,
              gewaehrleistung_note: warrantyNote || null,
            })
            lastSavedSerialized.current = serialized
          }
          setSaveStatus('saved')
        } catch (error) {
          setSaveStatus('error')
          toast.error(getErrorMessage(error, 'Failed to save sale'))
        }
      })()
    }, AUTO_SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(handle)
  }, [isDraft, vehicleId, customerId, priceNumber, saleId, navigate, createSale, updateSale, contractDate, handoverDate, buyerIsConsumer, shorteningNegotiated, warrantyNote])

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
    <div className="space-y-6">
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
          <CustomerSearch value={customer} onChange={handleCustomerChange} />
        </div>
        <div className="space-y-4">
          <label className="space-y-1 text-sm">
            <span className="text-slate-500">Sale price (gross)</span>
            <Input
              disabled={!isDraft}
              type="number"
              value={salePrice}
              onChange={(event) => setSalePrice(event.target.value)}
            />
          </label>
          <section aria-labelledby="gewaehrleistung-form-title" className="space-y-3 rounded-lg border p-4">
            <h2 id="gewaehrleistung-form-title" className="font-medium">Gewährleistung</h2>
            <label className="block space-y-1 text-sm">
              <span className="text-slate-500">Vertragsdatum</span>
              <Input aria-label="Vertragsdatum" type="date" disabled={!isDraft} value={contractDate} onChange={(event) => setContractDate(event.target.value)} />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-slate-500">Übergabedatum</span>
              <Input aria-label="Übergabedatum" type="date" disabled={!isDraft} value={handoverDate} onChange={(event) => setHandoverDate(event.target.value)} />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={buyerIsConsumer} disabled={!isDraft} onChange={(event) => {
                setBuyerIsConsumer(event.target.checked)
                if (!event.target.checked) setShorteningNegotiated(false)
              }} />
              Käufer:in ist Verbraucher:in
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={shorteningNegotiated} disabled={!isDraft || !buyerIsConsumer} onChange={(event) => setShorteningNegotiated(event.target.checked)} />
              Verkürzung wurde ausdrücklich vereinbart
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-slate-500">Notiz zur Gewährleistung</span>
              <textarea aria-label="Notiz zur Gewährleistung" disabled={!isDraft} className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" value={warrantyNote} onChange={(event) => setWarrantyNote(event.target.value)} />
            </label>
            <p className="text-xs text-slate-500">Verlängerungen durch Reparaturen werden nicht erfasst.</p>
          </section>
          {vehicle ? (
            <NovaPreviewPanel
              vehicleId={vehicle.id}
              firstRegistrationDate={vehicle.first_registration_date ?? null}
              co2Wltp={vehicle.co2_wltp_g_km ?? null}
              co2Nedc={vehicle.co2_nedc_g_km ?? null}
              typenscheinNo={vehicle.typenschein_no ?? null}
              novaClass={vehicle.nova_class ?? null}
            />
          ) : null}
        </div>
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
