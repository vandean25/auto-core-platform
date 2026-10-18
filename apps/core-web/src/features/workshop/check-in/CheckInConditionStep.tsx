import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { generateId } from '@/lib/id'
import type { CheckInDamageMarker, WorkshopCheckInMedia } from '@/api/workshop-check-in'
import { describeWorkshopCheckInError } from './check-in-errors'
import type { CheckInDraftSnapshot } from './check-in-draft'
import {
  CHECK_IN_DAMAGE_TYPES,
  CHECK_IN_ZONE_IDS,
  type CheckInDamageType,
  type CheckInZoneId,
} from './check-in-zones'
import { CheckInVehicleSketch } from './CheckInVehicleSketch'

const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp'

type Props = {
  orderId: string
  draft: CheckInDraftSnapshot
  readOnly: boolean
  expectedRevision: number
  media: WorkshopCheckInMedia[]
  localPreviewUrls: Record<string, string>
  onRegisterPreview: (mediaId: string, objectUrl: string) => void
  onPatch: (patch: Partial<CheckInDraftSnapshot>) => void
  onRevisionBump: () => void
  onMediaUploaded: (media: WorkshopCheckInMedia) => void
  onQueuePhoto: (file: File, clientUploadId: string) => Promise<void>
  pendingUploadIds: string[]
  onRetryUploads: () => void
}

export function CheckInConditionStep({
  orderId,
  draft,
  readOnly,
  expectedRevision,
  media,
  localPreviewUrls,
  onRegisterPreview,
  onPatch,
  onRevisionBump,
  onMediaUploaded,
  onQueuePhoto,
  pendingUploadIds,
  onRetryUploads,
}: Props) {
  const { t } = useTranslation('workshop')
  const [isCapturing, setIsCapturing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [zoneId, setZoneId] = useState<CheckInZoneId>('FRONT_BUMPER')
  const [damageType, setDamageType] = useState<CheckInDamageType>('SCRATCH')
  const [note, setNote] = useState('')
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([])
  const previewUrlsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    return () => {
      for (const url of previewUrlsRef.current) {
        URL.revokeObjectURL(url)
      }
      previewUrlsRef.current.clear()
    }
  }, [])

  const handleCapture = async (file: File) => {
    if (readOnly) {
      return
    }
    const clientUploadId = generateId()
    setIsCapturing(true)
    try {
      const preview = URL.createObjectURL(file)
      previewUrlsRef.current.add(preview)
      onRegisterPreview(clientUploadId, preview)
      setSelectedMediaIds((previous) =>
        previous.includes(clientUploadId)
          ? previous
          : [...previous, clientUploadId],
      )
      await onQueuePhoto(file, clientUploadId)
      onMediaUploaded({
        id: clientUploadId,
        purpose: 'CHECK_IN',
        mime_type: file.type || 'image/jpeg',
        size_bytes: file.size,
        processing_status: 'PENDING',
      })
      onRevisionBump()
      toast.success(t('checkIn.media.queued'))
    } catch (error: unknown) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code?: string }).code)
          : ''
      if (code === 'CHECK_IN_OFFLINE_QUOTA') {
        toast.error(t('checkIn.offline.quotaExceeded'))
      } else {
        toast.error(describeWorkshopCheckInError(error))
      }
    } finally {
      setIsCapturing(false)
    }
  }

  const addMarker = () => {
    if (readOnly) {
      return
    }
    const marker: CheckInDamageMarker = {
      id: generateId(),
      zone_id: zoneId,
      type: damageType,
      note: note.trim(),
      media_ids: selectedMediaIds,
    }
    onPatch({ damage_markers: [...draft.damage_markers, marker] })
    setNote('')
    setSelectedMediaIds([])
  }

  const toggleMediaSelection = (mediaId: string) => {
    setSelectedMediaIds((previous) =>
      previous.includes(mediaId)
        ? previous.filter((id) => id !== mediaId)
        : [...previous, mediaId],
    )
  }

  const allMedia = media
  const markedZoneIds = new Set(draft.damage_markers.map((marker) => marker.zone_id))

  return (
    <div className="space-y-8" data-testid="check-in-step-condition">
      <section aria-labelledby="check-in-photos-heading" className="space-y-4">
        <h2 id="check-in-photos-heading" className="text-xl font-semibold">
          {t('checkIn.steps.condition.photosTitle')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('checkIn.steps.condition.photosHint')}</p>
        <input
          id="check-in-camera-input"
          ref={fileInputRef}
          type="file"
          accept={PHOTO_ACCEPT}
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="check-in-camera-input"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) {
              void handleCapture(file)
            }
            event.target.value = ''
          }}
        />
        <Button
          type="button"
          className="min-h-11"
          disabled={readOnly || isCapturing}
          onClick={() => fileInputRef.current?.click()}
        >
          {isCapturing ? t('checkIn.media.uploading') : t('checkIn.media.capture')}
        </Button>
        {pendingUploadIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{t('checkIn.media.pendingUploads', { count: pendingUploadIds.length })}</span>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={onRetryUploads}
            >
              {t('checkIn.actions.retry')}
            </Button>
          </div>
        )}
        {allMedia.length > 0 && (
          <ul className="flex flex-wrap gap-3" aria-label={t('checkIn.media.galleryAria')}>
            {allMedia.map((item) => {
              const src = localPreviewUrls[item.id] ?? item.preview_url ?? undefined
              const selected = selectedMediaIds.includes(item.id)
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`relative h-24 w-24 overflow-hidden rounded-md border-2 ${
                      selected ? 'border-primary' : 'border-transparent'
                    }`}
                    disabled={readOnly}
                    onClick={() => toggleMediaSelection(item.id)}
                    aria-pressed={selected}
                    aria-label={t('checkIn.media.selectPhoto', { id: item.id.slice(0, 8) })}
                  >
                    {src ? (
                      <img src={src} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full items-center justify-center px-1 text-center text-xs text-muted-foreground">
                        {pendingUploadIds.includes(item.id)
                          ? t('checkIn.media.pendingUpload')
                          : t('checkIn.media.pending')}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="check-in-damage-heading" className="space-y-4">
        <h2 id="check-in-damage-heading" className="text-xl font-semibold">
          {t('checkIn.steps.condition.damageTitle')}
        </h2>
        <div className="grid gap-6 lg:grid-cols-2">
          <CheckInVehicleSketch
            selectedZoneId={zoneId}
            markedZoneIds={markedZoneIds}
            disabled={readOnly}
            onZoneSelect={setZoneId}
          />
          <div className="space-y-3">
            <Label htmlFor="check-in-zone">{t('checkIn.fields.damageZone')}</Label>
            <Select
              disabled={readOnly}
              value={zoneId}
              onValueChange={(value) => setZoneId(value as CheckInZoneId)}
            >
              <SelectTrigger id="check-in-zone" className="min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHECK_IN_ZONE_IDS.map((id) => (
                  <SelectItem key={id} value={id} className="min-h-11">
                    {t(`checkIn.zones.${id}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Label htmlFor="check-in-damage-type">{t('checkIn.fields.damageType')}</Label>
            <Select
              disabled={readOnly}
              value={damageType}
              onValueChange={(value) => setDamageType(value as CheckInDamageType)}
            >
              <SelectTrigger id="check-in-damage-type" className="min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHECK_IN_DAMAGE_TYPES.map((type) => (
                  <SelectItem key={type} value={type} className="min-h-11">
                    {t(`checkIn.damageTypes.${type}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Label htmlFor="check-in-damage-note">{t('checkIn.fields.damageNote')}</Label>
            <Input
              id="check-in-damage-note"
              className="min-h-11"
              disabled={readOnly}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <Button
              type="button"
              className="min-h-11"
              disabled={readOnly}
              onClick={addMarker}
              data-testid="check-in-add-marker"
            >
              {t('checkIn.actions.addDamageMarker')}
            </Button>
          </div>
          <ul className="space-y-2" aria-label={t('checkIn.damageListAria')}>
            {draft.damage_markers.length === 0 ? (
              <li className="text-sm text-muted-foreground">{t('checkIn.damageEmpty')}</li>
            ) : (
              draft.damage_markers.map((marker) => (
                <li
                  key={marker.id}
                  className="rounded-md border px-3 py-2 text-sm"
                  data-testid="check-in-damage-marker"
                >
                  <span className="font-medium">
                    {t(`checkIn.zones.${marker.zone_id as CheckInZoneId}`)}
                  </span>
                  {' · '}
                  {t(`checkIn.damageTypes.${marker.type}`)}
                  {marker.note ? ` — ${marker.note}` : ''}
                </li>
              ))
            )}
          </ul>
        </div>
      </section>
    </div>
  )
}
