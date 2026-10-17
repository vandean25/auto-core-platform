import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import sketchSvg from './assets/check-in-vehicle-sketch-v1.svg?raw'
import {
  CHECK_IN_ZONE_IDS,
  type CheckInZoneId,
} from './check-in-zones'

const SKETCH_ZONE_IDS = CHECK_IN_ZONE_IDS.filter((id) => id !== 'OTHER')

type Props = {
  selectedZoneId: CheckInZoneId
  markedZoneIds: ReadonlySet<string>
  disabled: boolean
  onZoneSelect: (zoneId: CheckInZoneId) => void
}

export function CheckInVehicleSketch({
  selectedZoneId,
  markedZoneIds,
  disabled,
  onZoneSelect,
}: Props) {
  const { t } = useTranslation('workshop')
  const sketchRef = useRef<HTMLDivElement>(null)
  const onZoneSelectRef = useRef(onZoneSelect)

  useEffect(() => {
    onZoneSelectRef.current = onZoneSelect
  }, [onZoneSelect])

  useEffect(() => {
    const root = sketchRef.current
    if (!root) {
      return
    }

    const cleanups: Array<() => void> = []

    for (const zoneId of SKETCH_ZONE_IDS) {
      const zone = root.querySelector<SVGGElement>(`#${CSS.escape(zoneId)}`)
      if (!zone) {
        continue
      }
      zone.setAttribute('role', 'button')
      zone.setAttribute('tabindex', disabled ? '-1' : '0')
      zone.setAttribute(
        'aria-label',
        markedZoneIds.has(zoneId)
          ? `${t(`checkIn.zones.${zoneId}`)} (${t('checkIn.sketch.hasMarker')})`
          : t(`checkIn.zones.${zoneId}`),
      )
      zone.setAttribute('aria-pressed', String(selectedZoneId === zoneId))
      if (selectedZoneId === zoneId) {
        zone.setAttribute('data-selected', 'true')
      } else {
        zone.removeAttribute('data-selected')
      }
      if (markedZoneIds.has(zoneId)) {
        zone.setAttribute('data-marked', 'true')
      } else {
        zone.removeAttribute('data-marked')
      }

      const handleClick = (event: MouseEvent) => {
        event.stopPropagation()
        if (!disabled) {
          onZoneSelectRef.current(zoneId)
        }
      }
      const handleKeyDown = (event: KeyboardEvent) => {
        if (disabled || (event.key !== 'Enter' && event.key !== ' ')) {
          return
        }
        event.preventDefault()
        onZoneSelectRef.current(zoneId)
      }

      zone.addEventListener('click', handleClick)
      zone.addEventListener('keydown', handleKeyDown)
      cleanups.push(() => {
        zone.removeEventListener('click', handleClick)
        zone.removeEventListener('keydown', handleKeyDown)
      })
    }

    return () => {
      for (const cleanup of cleanups) {
        cleanup()
      }
    }
  }, [disabled, markedZoneIds, selectedZoneId, t])

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{t('checkIn.sketch.hint')}</p>
      <div
        ref={sketchRef}
        className="check-in-vehicle-sketch relative mx-auto min-w-80 max-w-sm rounded-md border bg-white p-2"
        data-testid="check-in-vehicle-sketch"
        role="group"
        aria-label={t('checkIn.sketch.aria')}
      >
        <div
          className="[&_svg]:mx-auto [&_svg]:h-auto [&_svg]:w-full [&_g[id]]:cursor-pointer [&_g[id]]:outline-none [&_g[id]]:transition [&_g[id]]:duration-150 [&_g[id]:focus-visible]:ring-2 [&_g[id]:focus-visible]:ring-primary [&_g[id]:hover]:opacity-80 [&_g[id][data-selected=true]_*]:fill-primary/30 [&_g[id][data-marked=true]_*]:stroke-primary"
          dangerouslySetInnerHTML={{ __html: sketchSvg }}
        />
      </div>
    </div>
  )
}
