import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { WorkshopCheckInInspectionChecklist } from './WorkshopCheckInInspectionChecklist'
import type { CheckInDraftSnapshot } from './check-in-draft'
import { CHECK_IN_TYRE_SEASONS } from './check-in-zones'

type Props = {
  orderId: string
  draft: CheckInDraftSnapshot
  readOnly: boolean
  onPatch: (patch: Partial<CheckInDraftSnapshot>) => void
  onPatchCondition: (patch: Partial<CheckInDraftSnapshot['condition']>) => void
}

export function CheckInVehicleStep({
  orderId,
  draft,
  readOnly,
  onPatch,
  onPatchCondition,
}: Props) {
  const { t } = useTranslation('workshop')
  const [warningLightsInput, setWarningLightsInput] = useState(
    draft.warning_lights.join(', '),
  )

  useEffect(() => {
    setWarningLightsInput(draft.warning_lights.join(', '))
  }, [draft.warning_lights])

  const commitWarningLights = () => {
    const parts = warningLightsInput
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
    onPatch({ warning_lights: parts })
  }

  return (
    <div className="space-y-8" data-testid="check-in-step-vehicle">
      <section aria-labelledby="check-in-mileage-heading" className="space-y-4">
        <h2 id="check-in-mileage-heading" className="text-xl font-semibold">
          {t('checkIn.steps.vehicle.mileageTitle')}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="check-in-odometer">{t('checkIn.fields.odometer')}</Label>
            <Input
              id="check-in-odometer"
              type="number"
              inputMode="numeric"
              min={0}
              className="min-h-11"
              disabled={readOnly}
              value={draft.odometer}
              onChange={(event) =>
                onPatch({ odometer: Number.parseInt(event.target.value, 10) || 0 })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="check-in-fuel">{t('checkIn.fields.fuelLevel')}</Label>
            <Input
              id="check-in-fuel"
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              className="min-h-11"
              disabled={readOnly}
              value={draft.fuel_level}
              onChange={(event) =>
                onPatch({
                  fuel_level: Math.min(
                    100,
                    Math.max(0, Number.parseInt(event.target.value, 10) || 0),
                  ),
                })
              }
            />
          </div>
        </div>
      </section>

      <section aria-labelledby="check-in-belongings-heading" className="space-y-4">
        <h2 id="check-in-belongings-heading" className="text-xl font-semibold">
          {t('checkIn.steps.vehicle.belongingsTitle')}
        </h2>
        <div className="space-y-2">
          <Label htmlFor="check-in-items-left">{t('checkIn.fields.itemsLeft')}</Label>
          <textarea
            id="check-in-items-left"
            className="flex min-h-[88px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base md:text-sm"
            disabled={readOnly}
            value={draft.items_left}
            onChange={(event) => onPatch({ items_left: event.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="check-in-key-count">{t('checkIn.fields.keyCount')}</Label>
          <Input
            id="check-in-key-count"
            type="number"
            min={0}
            max={10}
            className="min-h-11 max-w-[160px]"
            disabled={readOnly}
            value={draft.key_count}
            onChange={(event) =>
              onPatch({
                key_count: Math.min(
                  10,
                  Math.max(0, Number.parseInt(event.target.value, 10) || 0),
                ),
              })
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="check-in-warning-lights">{t('checkIn.fields.warningLights')}</Label>
          <Input
            id="check-in-warning-lights"
            className="min-h-11"
            disabled={readOnly}
            placeholder={t('checkIn.fields.warningLightsPlaceholder')}
            value={warningLightsInput}
            onChange={(event) => setWarningLightsInput(event.target.value)}
            onBlur={commitWarningLights}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="check-in-tyre-season">{t('checkIn.fields.tyreSeason')}</Label>
          <Select
            disabled={readOnly}
            value={draft.condition.tyre_season}
            onValueChange={(value) =>
              onPatchCondition({
                tyre_season: value as CheckInDraftSnapshot['condition']['tyre_season'],
              })
            }
          >
            <SelectTrigger id="check-in-tyre-season" className="min-h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHECK_IN_TYRE_SEASONS.map((season) => (
                <SelectItem key={season} value={season} className="min-h-11">
                  {t(`checkIn.tyreSeason.${season}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      <WorkshopCheckInInspectionChecklist orderId={orderId} />
    </div>
  )
}
