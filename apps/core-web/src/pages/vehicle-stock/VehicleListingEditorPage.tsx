import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DocumentSaveIndicator } from '@/components/document-save/DocumentSaveIndicator'
import { useDebouncedAutoSave } from '@/hooks/useDebouncedAutoSave'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { formatCurrency } from '@/lib/format'
import { getErrorCode, getErrorStatus } from '@/lib/error-utils'
import { generateId } from '@/lib/id'
import { useVehicleStockDetail } from '@/api/vehicle-stock'
import {
  useCreateVehicleListing,
  usePatchVehicleListing,
  usePatchVehicleListingChannel,
  useVehicleListing,
  useVehicleListingValidation,
  vehicleListingKeys,
  type VehicleListingDto,
} from '@/api/vehicle-listing'
import {
  useReplaceVehicleEquipment,
  useVehicleEquipmentAssignment,
  useVehicleEquipmentOptions,
  type VehicleEquipmentAssertion,
} from '@/api/vehicle-equipment'
import { useVehicleStockPhotos } from '@/api/vehicle-stock-photos'
import {
  draftToPatchPayload,
  draftsEqual,
  listingToDraft,
  type ListingDraft,
} from '@/features/vehicle-stock/listing/listing-draft'
import { ListingFieldErrors } from '@/features/vehicle-stock/listing/ListingFieldErrors'
import { mergeChannelValidationIssues } from '@/features/vehicle-stock/listing/listing-field-issues'
import { parseListingGrossPrice } from '@/features/vehicle-stock/listing/listing-price'
import {
  getListingFieldIssuesFromError,
  translateListingErrorCode,
  translateListingIssue,
} from '@/features/vehicle-stock/listing/listing-issue-i18n'

function resolveReceivedPurchaseId(
  purchases: Array<{ id: string; status: string }> | undefined,
): string | null {
  const received = purchases?.find((row) => row.status === 'RECEIVED')
  return received?.id ?? null
}

function TriStateAssertion({
  label,
  value,
  onChange,
  issues,
  field,
  presentLabel,
  absentLabel,
  unsetLabel,
}: {
  label: string
  presentLabel: string
  absentLabel: string
  unsetLabel: string
  value: boolean | null
  onChange: (next: boolean | null) => void
  issues: Array<{ field: string; message: string }>
  field: string
}) {
  return (
    <div className="space-y-1 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant={value === true ? 'default' : 'outline'}
            aria-pressed={value === true}
            aria-label={`${label}: ${presentLabel}`}
            onClick={() => onChange(true)}
          >
            {presentLabel}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={value === false ? 'default' : 'outline'}
            aria-pressed={value === false}
            aria-label={`${label}: ${absentLabel}`}
            onClick={() => onChange(false)}
          >
            {absentLabel}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={value === null ? 'secondary' : 'ghost'}
            aria-pressed={value === null}
            aria-label={`${label}: ${unsetLabel}`}
            onClick={() => onChange(null)}
          >
            {unsetLabel}
          </Button>
        </div>
      </div>
      <ListingFieldErrors issues={issues} field={field} />
    </div>
  )
}

function listingToastDescription(
  t: ReturnType<typeof useTranslation<'vehicleStock'>>['t'],
  error: unknown,
): string {
  const fieldIssues = getListingFieldIssuesFromError(error)
  if (fieldIssues.length > 0) {
    return fieldIssues.map((issue) => translateListingIssue(t, issue)).join(' ')
  }
  return translateListingErrorCode(t, getErrorCode(error))
}

export default function VehicleListingEditorPage() {
  const { vehicleId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { t, i18n } = useTranslation('vehicleStock')

  React.useEffect(() => {
    void ensureNamespaceLoaded('vehicleStock')
  }, [])

  const { data: vehicle, isLoading: vehicleLoading } = useVehicleStockDetail(vehicleId)
  const listingQuery = useVehicleListing(vehicleId)
  const createListing = useCreateVehicleListing(vehicleId)
  const patchListing = usePatchVehicleListing(vehicleId)
  const patchChannel = usePatchVehicleListingChannel(vehicleId)
  const validationQuery = useVehicleListingValidation(
    vehicleId,
    Boolean(listingQuery.data),
  )
  const { data: photos = [] } = useVehicleStockPhotos(vehicleId)
  const { data: equipmentOptions = [] } = useVehicleEquipmentOptions()
  const equipmentAssignment = useVehicleEquipmentAssignment(vehicleId)
  const replaceEquipment = useReplaceVehicleEquipment(vehicleId)

  const revisionRef = React.useRef(1)
  const [draft, setDraft] = React.useState<ListingDraft | null>(null)
  const [savedDraft, setSavedDraft] = React.useState<ListingDraft | null>(null)
  const [revisionConflict, setRevisionConflict] = React.useState(false)
  const [creatingListing, setCreatingListing] = React.useState(false)
  const [createFailed, setCreateFailed] = React.useState(false)
  const createAttemptedRef = React.useRef(false)
  const pendingCreateIdRef = React.useRef<string | null>(null)
  const stockPurchaseId = resolveReceivedPurchaseId(
    vehicle?.purchases as Array<{ id: string; status: string }> | undefined,
  )

  const applyListing = React.useCallback((listing: VehicleListingDto) => {
    revisionRef.current = listing.revision
    const nextDraft = listingToDraft(listing)
    setDraft(nextDraft)
    setSavedDraft(nextDraft)
    setRevisionConflict(false)
  }, [])

  React.useEffect(() => {
    if (!listingQuery.data || draft !== null) {
      return
    }
    applyListing(listingQuery.data)
  }, [applyListing, draft, listingQuery.data])

  const runCreateListing = React.useCallback(() => {
    if (!stockPurchaseId || createListing.isPending) {
      return
    }
    const createId = pendingCreateIdRef.current ?? generateId()
    pendingCreateIdRef.current = createId
    setCreateFailed(false)
    setCreatingListing(true)
    void createListing
      .mutateAsync({
        id: createId,
        expected_stock_purchase_id: stockPurchaseId,
      })
      .then(applyListing)
      .catch(() => {
        setCreateFailed(true)
        toast.error(t('listing.createError.title'), {
          description: t('listing.createError.description'),
        })
      })
      .finally(() => setCreatingListing(false))
  }, [applyListing, createListing, stockPurchaseId, t])

  React.useEffect(() => {
    if (
      !vehicleId ||
      !stockPurchaseId ||
      !listingQuery.isSuccess ||
      listingQuery.data !== null ||
      createAttemptedRef.current ||
      creatingListing ||
      createListing.isPending ||
      createFailed
    ) {
      return
    }
    createAttemptedRef.current = true
    runCreateListing()
  }, [
    createFailed,
    createListing.isPending,
    creatingListing,
    listingQuery.data,
    listingQuery.isSuccess,
    runCreateListing,
    stockPurchaseId,
    vehicleId,
  ])

  const save = React.useCallback(
    async (snapshot: ListingDraft, signal: AbortSignal) => {
      if (signal.aborted) return
      const updated = await patchListing.mutateAsync(
        draftToPatchPayload(snapshot, revisionRef.current),
      )
      revisionRef.current = updated.revision
      setSavedDraft(listingToDraft(updated))
      setRevisionConflict(false)
    },
    [patchListing],
  )

  const { saveStatus, triggerAutoSave, clearPendingSave, abortInFlightSave } =
    useDebouncedAutoSave({
      enabled: Boolean(draft) && !revisionConflict && Boolean(listingQuery.data),
      save,
      shouldSave: (snapshot) =>
        savedDraft !== null &&
        !draftsEqual(snapshot, savedDraft) &&
        parseListingGrossPrice(snapshot.price_gross_eur).valid,
      onError: (error) => {
        if (getErrorStatus(error) === 409) {
          setRevisionConflict(true)
        }
        toast.error(t('listing.errors.saveFailed'), {
          description: listingToastDescription(t, error),
        })
      },
    })

  const updateDraft = React.useCallback(
    (patch: Partial<ListingDraft>) => {
      setDraft((current) => {
        if (!current) return current
        const next = { ...current, ...patch }
        void triggerAutoSave(next)
        return next
      })
    },
    [triggerAutoSave],
  )

  const refreshFromServer = React.useCallback(async () => {
    clearPendingSave()
    abortInFlightSave()
    const result = await listingQuery.refetch()
    if (result.data) {
      applyListing(result.data)
    }
  }, [abortInFlightSave, applyListing, clearPendingSave, listingQuery])

  const validationChannels = validationQuery.data?.channels ?? []
  const mobileIssues = mergeChannelValidationIssues(validationChannels, 'MOBILE_DE')

  const equipmentSelectionMap = React.useMemo(() => {
    const map = new Map<string, VehicleEquipmentAssertion>()
    for (const row of equipmentAssignment.data?.selections ?? []) {
      map.set(row.option.id, row.assertion)
    }
    return map
  }, [equipmentAssignment.data?.selections])

  const setEquipmentAssertion = async (
    optionId: string,
    assertion: VehicleEquipmentAssertion | null,
  ) => {
    const currentSelections = equipmentAssignment.data?.selections ?? []
    const nextSelections = currentSelections
      .filter((row) => row.option.id !== optionId)
      .map((row) => ({ option_id: row.option.id, assertion: row.assertion }))
    if (assertion) {
      nextSelections.push({ option_id: optionId, assertion })
    }
    try {
      await replaceEquipment.mutateAsync({
        selections: nextSelections,
        free_text_lines:
          equipmentAssignment.data?.free_text_items.map((row) => row.text) ?? [],
      })
    } catch (error) {
      toast.error(t('listing.errors.equipmentFailed'), {
        description: listingToastDescription(t, error),
      })
    }
  }

  const orderedListingPhotos = React.useMemo(() => {
    if (!draft) return []
    const byId = new Map(photos.map((photo) => [photo.id, photo]))
    return draft.photo_ids
      .map((id) => byId.get(id))
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
  }, [draft, photos])

  const excludedPhotos = React.useMemo(() => {
    if (!draft) return photos
    return photos.filter((photo) => !draft.photo_ids.includes(photo.id))
  }, [draft, photos])

  const movePhoto = (mediaId: string, direction: -1 | 1) => {
    if (!draft) return
    const index = draft.photo_ids.indexOf(mediaId)
    if (index < 0) return
    const target = index + direction
    if (target < 0 || target >= draft.photo_ids.length) return
    const nextIds = draft.photo_ids.slice()
    const [removed] = nextIds.splice(index, 1)
    nextIds.splice(target, 0, removed)
    updateDraft({ photo_ids: nextIds })
  }

  const togglePhotoIncluded = (mediaId: string) => {
    if (!draft) return
    if (draft.photo_ids.includes(mediaId)) {
      updateDraft({ photo_ids: draft.photo_ids.filter((id) => id !== mediaId) })
      return
    }
    updateDraft({ photo_ids: [...draft.photo_ids, mediaId] })
  }

  const toggleChannelActive = async (platform: string, active: boolean) => {
    const localDraft = draft
    const localSaved = savedDraft
    clearPendingSave()
    abortInFlightSave()
    try {
      const updated = await patchChannel.mutateAsync({
        platform,
        payload: {
          expected_revision: revisionRef.current,
          desired_state: active ? 'ACTIVE' : 'INACTIVE',
        },
      })
      revisionRef.current = updated.revision
      queryClient.setQueryData(vehicleListingKeys.detail(vehicleId), updated)
      const serverDraft = listingToDraft(updated)
      if (
        localDraft &&
        localSaved &&
        !draftsEqual(localDraft, localSaved)
      ) {
        setDraft(localDraft)
        setSavedDraft(serverDraft)
        void triggerAutoSave(localDraft)
      } else {
        applyListing(updated)
      }
    } catch (error) {
      toast.error(t('listing.errors.channelFailed'), {
        description: listingToastDescription(t, error),
      })
    }
  }

  if (listingQuery.isError) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm space-y-3">
        <h2 className="font-medium text-base">{t('listing.loadError.title')}</h2>
        <p className="text-slate-700">{t('listing.loadError.description')}</p>
        <Button size="sm" onClick={() => void listingQuery.refetch()}>
          {t('listing.loadError.retry')}
        </Button>
      </div>
    )
  }

  if (createFailed && !listingQuery.data) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm space-y-3">
        <h2 className="font-medium text-base">{t('listing.createError.title')}</h2>
        <p className="text-slate-700">{t('listing.createError.description')}</p>
        <Button
          size="sm"
          onClick={() => {
            createAttemptedRef.current = true
            runCreateListing()
          }}
        >
          {t('listing.createError.retry')}
        </Button>
      </div>
    )
  }

  if (vehicleLoading || listingQuery.isLoading || creatingListing) {
    return <p className="text-slate-500">{t('listing.loading')}</p>
  }

  if (!stockPurchaseId) {
    return <p className="text-slate-500">{t('listing.noStockCycle')}</p>
  }

  if (!vehicle || !draft || !listingQuery.data) {
    return <p className="text-slate-500">{t('listing.creating')}</p>
  }

  const listing = listingQuery.data
  const hasUnsavedDraftEdits =
    savedDraft !== null && draft !== null && !draftsEqual(draft, savedDraft)
  const displaySaveStatus =
    hasUnsavedDraftEdits && saveStatus === 'saved' ? 'idle' : saveStatus

  const parsedListingPrice = parseListingGrossPrice(draft.price_gross_eur)
  const pricePreview =
    parsedListingPrice.valid && parsedListingPrice.value !== null
      ? formatCurrency(parsedListingPrice.value)
      : null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('listing.backToStock')}
            onClick={() => navigate(APP_ROUTE_PATHS.vehicleStockDetail.replace(':vehicleId', vehicleId))}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t('listing.title')}</h1>
            <p className="text-slate-500">
              {vehicle.year} {vehicle.make} {vehicle.model}
            </p>
          </div>
        </div>
        <DocumentSaveIndicator status={displaySaveStatus} />
      </div>

      {revisionConflict ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-medium">{t('listing.revisionConflict.title')}</p>
          <p className="mt-1 text-slate-700">{t('listing.revisionConflict.description')}</p>
          <Button className="mt-3" size="sm" onClick={() => void refreshFromServer()}>
            {t('listing.revisionConflict.refresh')}
          </Button>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <section className="rounded-lg border p-4 space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {t('listing.sections.content')}
            </h2>
            <div>
              <Label htmlFor="listing-description">{t('listing.fields.description')}</Label>
              <textarea
                id="listing-description"
                className="mt-1 min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                value={draft.description}
                onChange={(event) => updateDraft({ description: event.target.value })}
              />
              <ListingFieldErrors issues={mobileIssues} field="listing.description" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="listing-description-language">
                  {t('listing.fields.descriptionLanguage')}
                </Label>
                <Select
                  value={draft.description_language}
                  onValueChange={(value: 'DE' | 'EN') =>
                    updateDraft({ description_language: value })
                  }
                >
                  <SelectTrigger id="listing-description-language" className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DE">{t('listing.fields.languageDe')}</SelectItem>
                    <SelectItem value="EN">{t('listing.fields.languageEn')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="listing-price">{t('listing.fields.priceGross')}</Label>
                <Input
                  id="listing-price"
                  inputMode="decimal"
                  className="mt-1"
                  value={draft.price_gross_eur}
                  onChange={(event) => updateDraft({ price_gross_eur: event.target.value })}
                  aria-invalid={!parsedListingPrice.valid}
                />
                {!parsedListingPrice.valid ? (
                  <p className="mt-1 text-xs text-destructive">{t('listing.errors.invalidPrice')}</p>
                ) : null}
                <ListingFieldErrors issues={mobileIssues} field="price_gross_eur" />
              </div>
            </div>
            <div>
              <Label htmlFor="listing-vat-display">{t('listing.fields.vatDisplay')}</Label>
              <Select
                value={draft.vat_display || 'unset'}
                onValueChange={(value) =>
                  updateDraft({
                    vat_display: value === 'unset' ? '' : (value as 'STANDARD' | 'MARGIN'),
                  })
                }
              >
                <SelectTrigger id="listing-vat-display" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset">{t('listing.fields.vatUnset')}</SelectItem>
                  <SelectItem value="STANDARD">{t('listing.fields.vatStandard')}</SelectItem>
                  <SelectItem value="MARGIN">{t('listing.fields.vatMargin')}</SelectItem>
                </SelectContent>
              </Select>
              <ListingFieldErrors issues={mobileIssues} field="vat_display" />
            </div>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={draft.nova_included_confirmed}
                  onCheckedChange={(checked) =>
                    updateDraft({ nova_included_confirmed: checked === true })
                  }
                />
                {t('listing.fields.novaIncluded')}
              </label>
              <ListingFieldErrors issues={mobileIssues} field="nova_included_confirmed" />
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={draft.mandatory_fees_included_confirmed}
                  onCheckedChange={(checked) =>
                    updateDraft({ mandatory_fees_included_confirmed: checked === true })
                  }
                />
                {t('listing.fields.mandatoryFeesIncluded')}
              </label>
              <ListingFieldErrors
                issues={mobileIssues}
                field="mandatory_fees_included_confirmed"
              />
            </div>
            {typeof listing.price_display?.consumer_hint_de === 'string' &&
            listing.price_display.consumer_hint_de ? (
              <p className="text-xs text-slate-500">
                {t('listing.fields.consumerHint')}: {listing.price_display.consumer_hint_de}
              </p>
            ) : null}
            <div>
              <Label htmlFor="listing-portal-category">{t('listing.fields.portalCategory')}</Label>
              <Input
                id="listing-portal-category"
                className="mt-1"
                value={draft.portal_category}
                onChange={(event) => updateDraft({ portal_category: event.target.value })}
              />
              <ListingFieldErrors issues={mobileIssues} field="portal_category" />
            </div>
            <div>
              <Label htmlFor="listing-equipment-free-text">
                {t('listing.fields.equipmentFreeText')}
              </Label>
              <textarea
                id="listing-equipment-free-text"
                className="mt-1 min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                value={draft.equipment_free_text}
                onChange={(event) => updateDraft({ equipment_free_text: event.target.value })}
              />
              <ListingFieldErrors issues={mobileIssues} field="equipment_free_text" />
            </div>
          </section>

          <section className="rounded-lg border p-4 space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {t('listing.sections.exportAssertions')}
            </h2>
            <TriStateAssertion
              label={t('listing.assertions.damageFree')}
              presentLabel={t('listing.equipment.present')}
              absentLabel={t('listing.equipment.absent')}
              unsetLabel={t('listing.equipment.unset')}
              field="export_assertion_damage_free"
              value={draft.export_assertion_damage_free}
              issues={mobileIssues}
              onChange={(next) => updateDraft({ export_assertion_damage_free: next })}
            />
            <TriStateAssertion
              label={t('listing.assertions.metallic')}
              presentLabel={t('listing.equipment.present')}
              absentLabel={t('listing.equipment.absent')}
              unsetLabel={t('listing.equipment.unset')}
              field="export_assertion_metallic"
              value={draft.export_assertion_metallic}
              issues={mobileIssues}
              onChange={(next) => updateDraft({ export_assertion_metallic: next })}
            />
            <TriStateAssertion
              label={t('listing.assertions.guarantee')}
              presentLabel={t('listing.equipment.present')}
              absentLabel={t('listing.equipment.absent')}
              unsetLabel={t('listing.equipment.unset')}
              field="export_assertion_guarantee"
              value={draft.export_assertion_guarantee}
              issues={mobileIssues}
              onChange={(next) => updateDraft({ export_assertion_guarantee: next })}
            />
            <TriStateAssertion
              label={t('listing.assertions.jahreswagen')}
              presentLabel={t('listing.equipment.present')}
              absentLabel={t('listing.equipment.absent')}
              unsetLabel={t('listing.equipment.unset')}
              field="export_assertion_jahreswagen"
              value={draft.export_assertion_jahreswagen}
              issues={mobileIssues}
              onChange={(next) => updateDraft({ export_assertion_jahreswagen: next })}
            />
            <TriStateAssertion
              label={t('listing.assertions.recommendation')}
              presentLabel={t('listing.equipment.present')}
              absentLabel={t('listing.equipment.absent')}
              unsetLabel={t('listing.equipment.unset')}
              field="export_assertion_recommendation"
              value={draft.export_assertion_recommendation}
              issues={mobileIssues}
              onChange={(next) => updateDraft({ export_assertion_recommendation: next })}
            />
            <TriStateAssertion
              label={t('listing.assertions.demoVehicle')}
              presentLabel={t('listing.equipment.present')}
              absentLabel={t('listing.equipment.absent')}
              unsetLabel={t('listing.equipment.unset')}
              field="export_assertion_demo_vehicle"
              value={draft.export_assertion_demo_vehicle}
              issues={mobileIssues}
              onChange={(next) => updateDraft({ export_assertion_demo_vehicle: next })}
            />
          </section>

          <section className="rounded-lg border p-4 space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {t('listing.sections.photos')}
            </h2>
            <p className="text-xs text-slate-500">{t('listing.sections.photosHint')}</p>
            <ListingFieldErrors issues={mobileIssues} field="images" />
            {photos.length === 0 ? (
              <p className="text-sm text-slate-500">{t('listing.photos.empty')}</p>
            ) : (
              <ul className="space-y-2">
                {orderedListingPhotos.map((photo, index) => (
                  <li
                    key={photo.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border p-2"
                  >
                    <div className="text-sm">
                      <span className="font-medium">#{index + 1}</span>
                      <span className="text-slate-500">
                        {' '}
                        · {photo.width}×{photo.height}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={index <= 0}
                        aria-label={t('listing.photos.moveUpA11y', { position: index + 1 })}
                        onClick={() => movePhoto(photo.id, -1)}
                      >
                        {t('listing.photos.moveUp')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={index >= draft.photo_ids.length - 1}
                        aria-label={t('listing.photos.moveDownA11y', { position: index + 1 })}
                        onClick={() => movePhoto(photo.id, 1)}
                      >
                        {t('listing.photos.moveDown')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        aria-label={t('listing.photos.exclude')}
                        onClick={() => togglePhotoIncluded(photo.id)}
                      >
                        {t('listing.photos.exclude')}
                      </Button>
                    </div>
                  </li>
                ))}
                {excludedPhotos.map((photo) => (
                  <li
                    key={photo.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-dashed p-2 opacity-80"
                  >
                    <div className="text-sm text-slate-500">
                      <span className="font-medium">—</span>
                      <span>
                        {' '}
                        · {photo.width}×{photo.height}
                      </span>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-label={t('listing.photos.include')}
                      onClick={() => togglePhotoIncluded(photo.id)}
                    >
                      {t('listing.photos.include')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border p-4 space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {t('listing.sections.equipment')}
            </h2>
            <p className="text-xs text-slate-500">{t('listing.sections.equipmentHint')}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {equipmentOptions.map((option) => {
                const assertion = equipmentSelectionMap.get(option.id) ?? null
                const label =
                  i18n.language.startsWith('en') ? option.label_en : option.label_de
                return (
                  <div key={option.id} className="rounded border p-2 space-y-2">
                    <p className="text-sm font-medium">{label}</p>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant={assertion === 'PRESENT' ? 'default' : 'outline'}
                        aria-pressed={assertion === 'PRESENT'}
                        aria-label={`${label}: ${t('listing.equipment.present')}`}
                        onClick={() => void setEquipmentAssertion(option.id, 'PRESENT')}
                      >
                        {t('listing.equipment.present')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={assertion === 'ABSENT' ? 'default' : 'outline'}
                        aria-pressed={assertion === 'ABSENT'}
                        aria-label={`${label}: ${t('listing.equipment.absent')}`}
                        onClick={() => void setEquipmentAssertion(option.id, 'ABSENT')}
                      >
                        {t('listing.equipment.absent')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={assertion === null ? 'secondary' : 'ghost'}
                        aria-pressed={assertion === null}
                        aria-label={`${label}: ${t('listing.equipment.unset')}`}
                        onClick={() => void setEquipmentAssertion(option.id, null)}
                      >
                        {t('listing.equipment.unset')}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="rounded-lg border p-4 space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {t('listing.sections.portals')}
            </h2>
            {validationQuery.isError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm space-y-2">
                <p className="text-destructive">{t('listing.portals.validationLoadError')}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void validationQuery.refetch()}
                >
                  {t('listing.loadError.retry')}
                </Button>
              </div>
            ) : null}
            <Tabs defaultValue={listing.channels[0]?.platform ?? 'MOBILE_DE'}>
              <TabsList>
                {listing.channels.map((channel) => (
                  <TabsTrigger key={channel.platform} value={channel.platform}>
                    {channel.platform.replace('_', '.')}
                  </TabsTrigger>
                ))}
              </TabsList>
              {listing.channels.map((channel) => {
                const channelIssues = mergeChannelValidationIssues(
                  validationChannels,
                  channel.platform,
                )
                const validationRow = validationChannels.find(
                  (row) => row.platform === channel.platform,
                )
                const isActive = channel.desired_state === 'ACTIVE'
                return (
                  <TabsContent key={channel.platform} value={channel.platform} className="space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <Label htmlFor={`channel-${channel.platform}`}>
                        {t('listing.portals.desiredActive')}
                      </Label>
                      <Checkbox
                        id={`channel-${channel.platform}`}
                        checked={isActive}
                        onCheckedChange={(checked) =>
                          void toggleChannelActive(channel.platform, checked === true)
                        }
                      />
                    </div>
                    <p className="text-xs text-slate-500">{t('listing.portals.validationTitle')}</p>
                    {validationRow && !validationRow.serializer_supported ? (
                      <p className="text-sm text-slate-600">
                        {t('listing.portals.serializerUnsupported')}
                      </p>
                    ) : null}
                    {validationQuery.isError ? null : channelIssues.length === 0 ? (
                      <p className="text-sm text-slate-600">{t('listing.portals.noIssues')}</p>
                    ) : (
                      <ul className="space-y-1 text-sm text-destructive">
                        {channelIssues.map((issue) => (
                          <li key={`${issue.field}-${issue.code ?? 'message'}`}>
                            {translateListingIssue(t, issue)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </TabsContent>
                )
              })}
            </Tabs>
          </section>

          <section className="rounded-lg border p-4 space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {t('listing.sections.vehicleFields')}
            </h2>
            <ListingFieldErrors issues={mobileIssues} field="vehicle.mileage_km" />
            <ListingFieldErrors issues={mobileIssues} field="vehicle.first_registration" />
            <ListingFieldErrors issues={mobileIssues} field="vehicle.make_model" />
            <ListingFieldErrors issues={mobileIssues} field="vehicle.stock_status" />
            <ListingFieldErrors issues={mobileIssues} field="vehicle.inventory_role" />
            <p className="text-xs text-slate-500">{t('listing.vehicleFieldHint')}</p>
            <Link
              className="text-sm text-primary underline"
              to={APP_ROUTE_PATHS.vehicleStockDetail.replace(':vehicleId', vehicleId)}
            >
              {vehicle.make} {vehicle.model}
            </Link>
          </section>
        </div>

        <aside className="rounded-lg border p-4 space-y-3 h-fit">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {t('listing.sections.preview')}
          </h2>
          <p className="text-xs text-slate-500">{t('listing.fields.listingRef')}</p>
          <p className="font-mono text-sm">{listing.listing_ref}</p>
          <p className="text-lg font-semibold">
            {pricePreview ?? t('listing.preview.untitled')}
          </p>
          <p className="text-sm whitespace-pre-wrap">
            {draft.description.trim() || t('listing.preview.noDescription')}
          </p>
          <p className="text-xs text-slate-500">
            {t('listing.preview.photoCount', { count: orderedListingPhotos.length })}
          </p>
        </aside>
      </div>
    </div>
  )
}
