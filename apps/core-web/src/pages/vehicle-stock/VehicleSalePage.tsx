import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Download } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatusBadge } from '@/components/status/StatusBadge'
import { CustomerSearch } from '@/components/sales/CustomerSearch'
import {
  VEHICLE_SALES_API,
  fetchVehicleSaleKaufvertragGenerationError,
  useCreateVehicleSale,
  useFinalizeVehicleSale,
  useUpdateVehicleSale,
  useVehicleSale,
  useVehicleStockDetail,
} from '@/api/vehicle-stock'
import type { Customer } from '@/api/types'
import { formatCurrency } from '@/lib/utils'
import { getErrorMessage } from '@/lib/error-utils'
import {
  GARANTIE_MONTHS_MESSAGE,
  negotiatedShorteningBlockReason,
  parseGarantieMonths,
} from '@/lib/vehicle-sale-warranty'
import { usePdfDownload } from '@/hooks/usePdfDownload'
import { NovaPreviewPanel } from '@/components/vehicles/NovaPreviewPanel'

const AUTO_SAVE_DEBOUNCE_MS = 750

type VehicleSaleDraftFacts = {
  vehicle_id: string
  customer_id: string
  sale_price: number
  contract_concluded_at: string | null
  handed_over_at: string | null
  buyer_is_consumer: boolean
  gewaehrleistung_shortened_negotiated: boolean
  gewaehrleistung_note: string | null
  garantie_months: number | null
  garantie_terms: string | null
}

function buildVehicleSaleDraftFacts(input: {
  vehicleId: string
  customerId: string
  salePrice: number
  contractDate: string
  handoverDate: string
  buyerIsConsumer: boolean
  shorteningNegotiated: boolean
  warrantyNote: string
  garantieMonths: number | null
  garantieTerms: string
}): VehicleSaleDraftFacts {
  return {
    vehicle_id: input.vehicleId,
    customer_id: input.customerId,
    sale_price: input.salePrice,
    contract_concluded_at: input.contractDate || null,
    handed_over_at: input.handoverDate || null,
    buyer_is_consumer: input.buyerIsConsumer,
    gewaehrleistung_shortened_negotiated:
      input.buyerIsConsumer && input.shorteningNegotiated,
    gewaehrleistung_note: input.warrantyNote || null,
    garantie_months: input.garantieMonths,
    garantie_terms:
      input.garantieMonths === null ? null : input.garantieTerms || null,
  }
}

const KAUFVERTRAG_FACTS_INCOMPLETE_MESSAGE =
  'Bitte Kaufpreis und Käufer angeben, bevor das PDF erstellt wird.'

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
  const saleIdRef = useRef(saleId)
  const { mutateAsync: updateSale } = useUpdateVehicleSale()
  const finalizeSale = useFinalizeVehicleSale()
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [salePrice, setSalePrice] = useState('')
  const [contractDate, setContractDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [handoverDate, setHandoverDate] = useState('')
  const [buyerIsConsumer, setBuyerIsConsumer] = useState(true)
  const [shorteningNegotiated, setShorteningNegotiated] = useState(false)
  const [warrantyNote, setWarrantyNote] = useState('')
  const [garantieMonthsInput, setGarantieMonthsInput] = useState('')
  const [garantieTerms, setGarantieTerms] = useState('')
  const garantie = parseGarantieMonths(garantieMonthsInput)
  const [isFinalizing, setIsFinalizing] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const lastSavedSerialized = useRef<string | null>(null)
  const hydratedSaleId = useRef<string | null>(null)
  const finalizing = useRef(false)
  const saveTimer = useRef<number | null>(null)
  const pendingSave = useRef<Promise<void> | null>(null)
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const { download: downloadKaufvertrag, isLoading: isDownloadingKaufvertrag } = usePdfDownload({
    postUrl: () => `${VEHICLE_SALES_API}/${saleIdRef.current}/kaufvertrag/pdf`,
    getUrl: () => `${VEHICLE_SALES_API}/${saleIdRef.current}/kaufvertrag/pdf`,
    filename: () =>
      `kaufvertrag-${(existing?.sale_number ?? saleIdRef.current).replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`,
    checkGenerationFailed: () => fetchVehicleSaleKaufvertragGenerationError(saleIdRef.current),
    messages: {
      success: 'Kaufvertrag-PDF heruntergeladen',
      errorFallback: 'Fehler beim Erstellen des Kaufvertrag-PDFs',
    },
  })
  const persistSaleFacts = useCallback(async (
    facts: VehicleSaleDraftFacts,
    serialized: string,
  ) => {
    const saveOperation = saveQueue.current.catch(() => undefined).then(async () => {
      setSaveStatus('saving')
      try {
        if (!saleIdRef.current) {
          const created = await createSale({
            vehicle_id: facts.vehicle_id,
            customer_id: facts.customer_id,
            sale_price: facts.sale_price,
            contract_concluded_at: facts.contract_concluded_at ?? undefined,
            handed_over_at: facts.handed_over_at ?? undefined,
            buyer_is_consumer: facts.buyer_is_consumer,
            gewaehrleistung_shortened_negotiated:
              facts.gewaehrleistung_shortened_negotiated,
            gewaehrleistung_note: facts.gewaehrleistung_note,
            garantie_months: facts.garantie_months,
            garantie_terms: facts.garantie_terms,
          })
          saleIdRef.current = created.id
          setSaleId(created.id)
          navigate(`/vehicle-stock/sales/${created.id}`, { replace: true })
        } else {
          await updateSale({
            id: saleIdRef.current,
            data: {
              customer_id: facts.customer_id,
              sale_price: facts.sale_price,
              contract_concluded_at: facts.contract_concluded_at,
              handed_over_at: facts.handed_over_at,
              buyer_is_consumer: facts.buyer_is_consumer,
              gewaehrleistung_shortened_negotiated:
                facts.gewaehrleistung_shortened_negotiated,
              gewaehrleistung_note: facts.gewaehrleistung_note,
              garantie_months: facts.garantie_months,
              garantie_terms: facts.garantie_terms,
            },
          })
        }
        lastSavedSerialized.current = serialized
        setSaveStatus('saved')
      } catch (error) {
        setSaveStatus('error')
        throw error
      }
    })
    saveQueue.current = saveOperation
    return saveOperation
  }, [createSale, updateSale, navigate])

  useEffect(() => {
    if (!existing || hydratedSaleId.current === existing.id) return
    hydratedSaleId.current = existing.id
    saleIdRef.current = existing.id
    setSaleId(existing.id)
    setSalePrice(String(existing.sale_price))
    setContractDate(existing.contract_concluded_at?.slice(0, 10) ?? '')
    setHandoverDate(existing.handed_over_at?.slice(0, 10) ?? '')
    setBuyerIsConsumer(existing.buyer_is_consumer ?? existing.customer?.type === 'PRIVATE')
    setShorteningNegotiated(existing.gewaehrleistung_shortened_negotiated ?? false)
    setWarrantyNote(existing.gewaehrleistung_note ?? '')
    setGarantieMonthsInput(existing.garantie_months != null ? String(existing.garantie_months) : '')
    setGarantieTerms(existing.garantie_terms ?? '')
    lastSavedSerialized.current = JSON.stringify({
      vehicle_id: existing.vehicle_id,
      customer_id: existing.customer_id,
      sale_price: Number(existing.sale_price),
      contract_concluded_at: existing.contract_concluded_at ?? null,
      handed_over_at: existing.handed_over_at ?? null,
      buyer_is_consumer: existing.buyer_is_consumer ?? existing.customer?.type === 'PRIVATE',
      gewaehrleistung_shortened_negotiated: existing.gewaehrleistung_shortened_negotiated ?? false,
      gewaehrleistung_note: existing.gewaehrleistung_note ?? null,
      garantie_months: existing.garantie_months ?? null,
      garantie_terms: existing.garantie_terms || null,
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
    if (finalizing.current) return
    setCustomer(nextCustomer)
    if (!nextCustomer) return
    const isConsumer = nextCustomer.type === 'PRIVATE'
    setBuyerIsConsumer(isConsumer)
    if (!isConsumer) setShorteningNegotiated(false)
  }

  const isDraft = !existing || existing.status === 'DRAFT'
  const customerId = customer?.id || existing?.customer_id || ''
  const priceNumber = Number(salePrice)
  const shorteningBlockReason = negotiatedShorteningBlockReason({
    buyerIsConsumer,
    firstRegistrationDate: vehicle?.first_registration_date ?? null,
    handoverDate,
  })

  useEffect(() => {
    if (isFinalizing || !isDraft || !vehicleId || !customerId || !priceNumber || !garantie.valid) return
    const saleFacts = buildVehicleSaleDraftFacts({
      vehicleId,
      customerId,
      salePrice: priceNumber,
      contractDate,
      handoverDate,
      buyerIsConsumer,
      shorteningNegotiated,
      warrantyNote,
      garantieMonths: garantie.value,
      garantieTerms,
    })
    const serialized = JSON.stringify(saleFacts)
    if (serialized === lastSavedSerialized.current) return
    const handle = window.setTimeout(() => {
      saveTimer.current = null
      const saveRequest = persistSaleFacts(saleFacts, serialized)
      pendingSave.current = saveRequest
      void saveRequest
        .catch((error) => toast.error(getErrorMessage(error, 'Failed to save sale')))
        .finally(() => {
          if (pendingSave.current === saveRequest) pendingSave.current = null
        })
    }, AUTO_SAVE_DEBOUNCE_MS)
    saveTimer.current = handle
    return () => {
      window.clearTimeout(handle)
      if (saveTimer.current === handle) saveTimer.current = null
    }
  }, [isFinalizing, isDraft, vehicleId, customerId, priceNumber, saleId, navigate, createSale, updateSale, contractDate, handoverDate, buyerIsConsumer, shorteningNegotiated, warrantyNote, garantie.value, garantie.valid, garantieTerms, persistSaleFacts])

  const finalize = async () => {
    if (!saleId || finalizing.current) return
    finalizing.current = true
    setIsFinalizing(true)
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    try {
      if (pendingSave.current) await pendingSave.current
      const currentFacts = buildVehicleSaleDraftFacts({
        vehicleId,
        customerId,
        salePrice: priceNumber,
        contractDate,
        handoverDate,
        buyerIsConsumer,
        shorteningNegotiated,
        warrantyNote,
        garantieMonths: garantie.value,
        garantieTerms,
      })
      const serialized = JSON.stringify(currentFacts)
      if (serialized !== lastSavedSerialized.current) {
        await persistSaleFacts(currentFacts, serialized)
      }
      const result = await finalizeSale.mutateAsync(saleId)
      toast.success('Sale invoiced')
      if (result.invoice?.id) {
        navigate(`/sales/invoices/${result.invoice.id}`)
      } else {
        navigate('/vehicle-stock')
      }
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to finalize sale'))
    } finally {
      finalizing.current = false
      setIsFinalizing(false)
    }
  }

  /**
   * Saves facts that are still inside the autosave window, so the PDF uses what the user sees.
   * Incomplete facts throw instead of being skipped, so the PDF never uses facts the user cannot see.
   */
  const persistCurrentFactsIfChanged = async () => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    if (pendingSave.current) await pendingSave.current
    if (!isDraft) return
    if (!garantie.valid) throw new Error(GARANTIE_MONTHS_MESSAGE)
    if (!vehicleId || !customerId || !priceNumber) {
      throw new Error(KAUFVERTRAG_FACTS_INCOMPLETE_MESSAGE)
    }
    const currentFacts = buildVehicleSaleDraftFacts({
      vehicleId,
      customerId,
      salePrice: priceNumber,
      contractDate,
      handoverDate,
      buyerIsConsumer,
      shorteningNegotiated,
      warrantyNote,
      garantieMonths: garantie.value,
      garantieTerms,
    })
    const serialized = JSON.stringify(currentFacts)
    if (serialized !== lastSavedSerialized.current) {
      await persistSaleFacts(currentFacts, serialized)
    }
  }

  const downloadKaufvertragPdf = async () => {
    if (!saleId || isDownloadingKaufvertrag) return
    try {
      await persistCurrentFactsIfChanged()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to save sale'))
      return
    }
    await downloadKaufvertrag()
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
          <Button
            variant="outline"
            disabled={
              !saleId ||
              isFinalizing ||
              isDownloadingKaufvertrag ||
              saveStatus === 'saving' ||
              existing?.status === 'CANCELLED'
            }
            onClick={() => void downloadKaufvertragPdf()}
          >
            <Download className="mr-2 h-4 w-4" />
            Kaufvertrag PDF
          </Button>
          <Button
            disabled={!saleId || !isDraft || isFinalizing || saveStatus === 'saving'}
            onClick={() => void finalize()}
          >
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
              disabled={!isDraft || isFinalizing}
              type="number"
              value={salePrice}
              onChange={(event) => setSalePrice(event.target.value)}
            />
          </label>
          <section aria-labelledby="gewaehrleistung-form-title" className="space-y-3 rounded-lg border p-4">
            <h2 id="gewaehrleistung-form-title" className="font-medium">Gewährleistung</h2>
            <label className="block space-y-1 text-sm">
              <span className="text-slate-500">Vertragsdatum</span>
              <Input
                aria-label="Vertragsdatum"
                type="date"
                disabled={!isDraft || isFinalizing}
                value={contractDate}
                onChange={(event) => setContractDate(event.target.value)}
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-slate-500">Übergabedatum</span>
              <Input
                aria-label="Übergabedatum"
                type="date"
                disabled={!isDraft || isFinalizing}
                value={handoverDate}
                onChange={(event) => setHandoverDate(event.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={buyerIsConsumer}
                disabled={!isDraft || isFinalizing}
                onChange={(event) => {
                  setBuyerIsConsumer(event.target.checked)
                  if (!event.target.checked) setShorteningNegotiated(false)
                }}
              />
              Käufer:in ist Verbraucher:in
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={shorteningNegotiated}
                disabled={
                  !isDraft ||
                  !buyerIsConsumer ||
                  isFinalizing ||
                  (shorteningBlockReason !== null && !shorteningNegotiated)
                }
                onChange={(event) => setShorteningNegotiated(event.target.checked)}
              />
              Verkürzung wurde ausdrücklich vereinbart
            </label>
            {shorteningBlockReason ? (
              <p className="text-xs text-rose-600">{shorteningBlockReason}</p>
            ) : null}
            <label className="block space-y-1 text-sm">
              <span className="text-slate-500">Notiz zur Gewährleistung</span>
              <textarea
                aria-label="Notiz zur Gewährleistung"
                disabled={!isDraft || isFinalizing}
                className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={warrantyNote}
                onChange={(event) => setWarrantyNote(event.target.value)}
              />
            </label>
            <div className="space-y-2 border-t pt-3">
              <h3 className="text-sm font-medium">Freiwillige Garantie (optional)</h3>
              <label className="block space-y-1 text-sm">
                <span className="text-slate-500">Garantiedauer (Monate)</span>
                <Input
                  aria-label="Garantiedauer in Monaten"
                  type="number"
                  min={1}
                  max={120}
                  step={1}
                  disabled={!isDraft || isFinalizing}
                  value={garantieMonthsInput}
                  onChange={(event) => {
                    setGarantieMonthsInput(event.target.value)
                    // Terms only apply with a duration, so clearing the duration clears the terms.
                    if (event.target.value.trim() === '') setGarantieTerms('')
                  }}
                />
              </label>
              {garantie.valid ? null : (
                <p className="text-xs text-rose-600">{GARANTIE_MONTHS_MESSAGE}</p>
              )}
              <label className="block space-y-1 text-sm">
                <span className="text-slate-500">Garantiebedingungen</span>
                <textarea
                  aria-label="Garantiebedingungen"
                  maxLength={2000}
                  disabled={!isDraft || isFinalizing || garantie.value === null}
                  className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={garantieTerms}
                  onChange={(event) => setGarantieTerms(event.target.value)}
                />
              </label>
              <p className="text-xs text-slate-500">
                Ohne Dauer erscheint im Kaufvertrag kein Garantieblock. Die Garantie gilt zusätzlich zur gesetzlichen Gewährleistung.
              </p>
            </div>
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
