import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Download } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatusBadge } from '@/components/status/StatusBadge'
import { CustomerSearch } from '@/components/sales/CustomerSearch'
import { GewaehrleistungFristen } from '@/components/vehicles/GewaehrleistungFristen'
import {
  VehicleSaleTradeInSection,
  type VehicleSaleTradeInHandle,
} from '@/components/vehicle-stock/VehicleSaleTradeInSection'
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
  gewaehrleistungStatusBadge,
  negotiatedShorteningBlockReason,
  parseGarantieMonths,
  shorteningSaveErrorMessage,
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

export default function VehicleSalePage() {
  const { t } = useTranslation('vehicleStock')
  useEffect(() => {
    void ensureNamespaceLoaded('vehicleStock')
  }, [])
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
  const [shorteningSaveError, setShorteningSaveError] = useState<string | null>(null)
  const lastSavedSerialized = useRef<string | null>(null)
  const hydratedSaleId = useRef<string | null>(null)
  const finalizing = useRef(false)
  const saveTimer = useRef<number | null>(null)
  const pendingSave = useRef<Promise<void> | null>(null)
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const tradeInRef = useRef<VehicleSaleTradeInHandle>(null)
  const { download: downloadKaufvertrag, isLoading: isDownloadingKaufvertrag } = usePdfDownload({
    postUrl: () => `${VEHICLE_SALES_API}/${saleIdRef.current}/kaufvertrag/pdf`,
    getUrl: () => `${VEHICLE_SALES_API}/${saleIdRef.current}/kaufvertrag/pdf`,
    filename: () =>
      `kaufvertrag-${(existing?.sale_number ?? saleIdRef.current).replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`,
    checkGenerationFailed: () => fetchVehicleSaleKaufvertragGenerationError(saleIdRef.current),
    messages: {
      success: t('sale.pdf.success'),
      errorFallback: t('sale.pdf.errorFallback'),
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
        setShorteningSaveError(null)
      } catch (error) {
        setSaveStatus('error')
        setShorteningSaveError(shorteningSaveErrorMessage(error))
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
    const storedContractDate = existing.contract_concluded_at?.slice(0, 10) ?? ''
    const storedHandoverDate = existing.handed_over_at?.slice(0, 10) ?? ''
    const storedBuyerIsConsumer = existing.buyer_is_consumer ?? existing.customer?.type === 'PRIVATE'
    const storedShortening = existing.gewaehrleistung_shortened_negotiated ?? false
    const storedWarrantyNote = existing.gewaehrleistung_note ?? ''
    const storedGarantieTerms = existing.garantie_terms ?? ''
    setContractDate(storedContractDate)
    setHandoverDate(storedHandoverDate)
    setBuyerIsConsumer(storedBuyerIsConsumer)
    setShorteningNegotiated(storedShortening)
    setWarrantyNote(storedWarrantyNote)
    setGarantieMonthsInput(existing.garantie_months != null ? String(existing.garantie_months) : '')
    setGarantieTerms(storedGarantieTerms)
    // Built by the same function as the autosave, so reopening an unchanged sale does not look like an edit.
    lastSavedSerialized.current = JSON.stringify(buildVehicleSaleDraftFacts({
      vehicleId: existing.vehicle_id,
      customerId: existing.customer_id,
      salePrice: Number(existing.sale_price),
      contractDate: storedContractDate,
      handoverDate: storedHandoverDate,
      buyerIsConsumer: storedBuyerIsConsumer,
      shorteningNegotiated: storedShortening,
      warrantyNote: storedWarrantyNote,
      garantieMonths: existing.garantie_months ?? null,
      garantieTerms: storedGarantieTerms,
    }))
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
  const shorteningMessage = shorteningSaveError ?? shorteningBlockReason

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
        .catch((error) => toast.error(getErrorMessage(error, t('sale.saveFailed'))))
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
      // A trade-in typed inside the autosave window must be saved first, or the invoice would bill the full price.
      await tradeInRef.current?.flush()
      const result = await finalizeSale.mutateAsync(saleId)
      toast.success(t('sale.invoicedSuccess'))
      if (result.invoice?.id) {
        navigate(`/sales/invoices/${result.invoice.id}`)
      } else {
        navigate('/vehicle-stock')
      }
    } catch (error) {
      setShorteningSaveError(shorteningSaveErrorMessage(error))
      toast.error(getErrorMessage(error, t('sale.finalizeFailed')))
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
    if (!garantie.valid) throw new Error(t('sale.warranty.monthsError'))
    if (!vehicleId || !customerId || !priceNumber) {
      throw new Error(t('sale.kaufvertragIncomplete'))
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
      toast.error(getErrorMessage(error, t('sale.saveFailed')))
      return
    }
    await downloadKaufvertrag()
  }

  const emDash = t('shared.emDash')
  const vatPreview = existing?.margin_vat_preview
  const costPreview = existing?.cost_basis_preview ?? vehicle?.cost_basis
  const warrantyBadge = existing?.gewaehrleistung_status
    ? gewaehrleistungStatusBadge(existing.gewaehrleistung_status)
    : null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            aria-label={vehicleId ? t('sale.backToVehicleAria') : t('sale.backAria')}
            onClick={() => navigate(vehicleId ? `/vehicle-stock/${vehicleId}` : '/vehicle-stock')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t('sale.title')}</h1>
            <p className="text-slate-500">
              {vehicle
                ? t('sale.vehicleSummary', {
                    year: vehicle.year,
                    make: vehicle.make,
                    model: vehicle.model,
                    taxMode: t('sale.subtitleMargin'),
                  })
                : t('sale.subtitleFallback')}
            </p>
          </div>
          {existing ? <StatusBadge status={existing.status} /> : null}
          {existing?.invoice ? (
            <Link
              to={`/sales/invoices/${existing.invoice.id}`}
              className="text-sm font-medium text-slate-700 underline-offset-4 hover:underline"
            >
              {existing.invoice.invoice_number
                ? t('sale.invoiceLink', { number: existing.invoice.invoice_number })
                : t('sale.openInvoice')}
            </Link>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          {saveStatus === 'saving' && <span className="text-sm text-slate-500">{t('sale.saveStatus.saving')}</span>}
          {saveStatus === 'saved' && <span className="text-sm text-emerald-600">{t('sale.saveStatus.saved')}</span>}
          {saveStatus === 'error' && <span className="text-sm text-rose-600">{t('sale.saveStatus.error')}</span>}
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
            {t('sale.downloadKaufvertrag')}
          </Button>
          <Button
            disabled={!saleId || !isDraft || isFinalizing || saveStatus === 'saving'}
            onClick={() => void finalize()}
          >
            {t('sale.finalizeInvoice')}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-4">
          <div className="space-y-1 text-sm">
            <span className="text-slate-500">{t('sale.buyer')}</span>
            <CustomerSearch value={customer} onChange={handleCustomerChange} />
          </div>
          <VehicleSaleTradeInSection
            ref={tradeInRef}
            saleId={saleId}
            salePrice={priceNumber}
            purchase={existing?.trade_in_purchase ?? null}
            editable={isDraft && !isFinalizing}
          />
        </div>
        <div className="space-y-4">
          <label className="space-y-1 text-sm">
            <span className="text-slate-500">{t('sale.salePriceGross')}</span>
            <Input
              disabled={!isDraft || isFinalizing}
              type="number"
              value={salePrice}
              onChange={(event) => setSalePrice(event.target.value)}
            />
          </label>
          <section aria-labelledby="gewaehrleistung-form-title" className="space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="gewaehrleistung-form-title" className="font-medium">{t('sale.gewaehrleistung')}</h2>
              {warrantyBadge ? <StatusBadge status={warrantyBadge.status} label={warrantyBadge.label} /> : null}
            </div>
            {existing?.gewaehrleistung_ends_on ? <GewaehrleistungFristen sale={existing} /> : null}
            <label className="block space-y-1 text-sm">
              <span className="text-slate-500">{t('sale.contractDate')}</span>
              <Input
                aria-label={t('sale.contractDate')}
                type="date"
                disabled={!isDraft || isFinalizing}
                value={contractDate}
                onChange={(event) => setContractDate(event.target.value)}
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-slate-500">{t('sale.handoverDate')}</span>
              <Input
                aria-label={t('sale.handoverDate')}
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
              {t('sale.warranty.consumerBuyer')}
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
                aria-invalid={shorteningSaveError !== null || (shorteningNegotiated && shorteningBlockReason !== null)}
                aria-describedby={shorteningMessage ? 'shortening-block-reason' : undefined}
                onChange={(event) => {
                  setShorteningSaveError(null)
                  setShorteningNegotiated(event.target.checked)
                }}
              />
              {t('sale.warranty.shorteningNegotiated')}
            </label>
            {shorteningMessage ? (
              <p
                id="shortening-block-reason"
                role={shorteningSaveError ? 'alert' : undefined}
                className="text-xs text-rose-600"
              >
                {shorteningMessage}
              </p>
            ) : null}
            <label className="block space-y-1 text-sm">
              <span className="text-slate-500">{t('sale.warranty.note')}</span>
              <textarea
                aria-label={t('sale.warranty.note')}
                disabled={!isDraft || isFinalizing}
                className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={warrantyNote}
                onChange={(event) => setWarrantyNote(event.target.value)}
              />
            </label>
            <div className="space-y-2 border-t pt-3">
              <h3 className="text-sm font-medium">{t('sale.warranty.optionalTitle')}</h3>
              <label className="block space-y-1 text-sm">
                <span className="text-slate-500">{t('sale.warranty.months')}</span>
                <Input
                  aria-label={t('sale.warranty.monthsAria')}
                  type="number"
                  min={1}
                  max={120}
                  step={1}
                  disabled={!isDraft || isFinalizing}
                  aria-invalid={!garantie.valid}
                  aria-describedby={garantie.valid ? undefined : 'garantie-months-error'}
                  value={garantieMonthsInput}
                  onChange={(event) => {
                    setGarantieMonthsInput(event.target.value)
                    // Terms only apply with a duration, so clearing the duration clears the terms.
                    if (event.target.value.trim() === '') setGarantieTerms('')
                  }}
                />
              </label>
              {garantie.valid ? null : (
                <p id="garantie-months-error" role="alert" className="text-xs text-rose-600">{t('sale.warranty.monthsError')}</p>
              )}
              <label className="block space-y-1 text-sm">
                <span className="text-slate-500">{t('sale.warranty.terms')}</span>
                <textarea
                  aria-label={t('sale.warranty.terms')}
                  maxLength={2000}
                  disabled={!isDraft || isFinalizing || garantie.value === null}
                  className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={garantieTerms}
                  onChange={(event) => setGarantieTerms(event.target.value)}
                />
              </label>
              <p className="text-xs text-slate-500">
                {t('sale.warranty.termsHint')}
              </p>
            </div>
            <p className="text-xs text-slate-500">{t('sale.warranty.repairsNote')}</p>
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
          <div className="text-xs text-slate-500">{t('sale.preview.costBasis')}</div>
          <div className="font-medium">
            {costPreview != null ? formatCurrency(costPreview) : emDash}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">{t('sale.preview.marginVat')}</div>
          <div className="font-medium">
            {vatPreview != null ? formatCurrency(vatPreview) : emDash}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">{t('sale.preview.taxMode')}</div>
          <div className="font-medium">{t('sale.preview.taxModeMarginScheme')}</div>
        </div>
      </div>

      {existing?.trade_in_purchase ? (
        <div className="rounded-lg border p-4 grid gap-3 md:grid-cols-3">
          <div>
            <div className="text-xs text-slate-500">{t('sale.tradeIn.vehicle')}</div>
            <div className="font-medium">
              {`${existing.trade_in_purchase.year} ${existing.trade_in_purchase.make} ${existing.trade_in_purchase.model}`}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">{t('sale.tradeIn.allowance')}</div>
            <div className="font-medium">{formatCurrency(existing.trade_in_purchase.purchase_price)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">{t('sale.tradeIn.amountDue')}</div>
            <div className="font-medium">
              {existing.amount_due_preview != null ? formatCurrency(existing.amount_due_preview) : emDash}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
