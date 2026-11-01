import { CircleCheck, TriangleAlert, OctagonAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { components } from '@/api/generated/openapi'
import { StatusBadge } from '@/components/status/StatusBadge'
import { NEUTRAL, statusClassMap } from '@/components/status/status-class-map'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import sketchSvg from '@/features/workshop/check-in/assets/check-in-vehicle-sketch-v1.svg?raw'

type Measurement = components['schemas']['TyreMeasurementResponseDto']
type Wheel = components['schemas']['TyreWheelResponseDto']
const POINTS = ['treadInnerMm', 'treadMiddleMm', 'treadOuterMm'] as const
const STATUS_ICONS = { GOOD: CircleCheck, RECOMMENDED: TriangleAlert, URGENT: OctagonAlert }
const WHEEL_PLACEMENT = {
  FL: 'lg:col-start-1 lg:row-start-1', FR: 'lg:col-start-3 lg:row-start-1',
  RL: 'lg:col-start-1 lg:row-start-2', RR: 'lg:col-start-3 lg:row-start-2',
  SPARE: 'lg:col-start-2 lg:row-start-3',
}

const REASON_SEVERITY: Record<string, number> = {
  TREAD_BELOW_LEGAL_MINIMUM: 100,
  AT_WINTER_TREAD_INSUFFICIENT: 90,
  DE_ALPINE_MISSING: 80,
  TREAD_REPLACEMENT_RECOMMENDED: 50,
  DOT_REPLACEMENT_RECOMMENDED: 40,
  DOT_LEGACY_OVER_20_YEARS: 30,
  DOT_CONDITION_CHECK_RECOMMENDED: 20,
  AT_WINTER_RULE_NOTICE: 10,
  UNSUPPORTED_COUNTRY: 5,
}

export function getWheelReasonLine(
  wheel: Wheel,
  t: TFunction<'workshop', undefined>,
): string | null {
  const { evaluation } = wheel
  if (evaluation.status !== 'URGENT' && evaluation.status !== 'RECOMMENDED') {
    return null
  }
  const codes = evaluation.reasonCodes ?? []
  if (codes.length === 0) {
    return null
  }
  const sortedCodes = [...codes].sort(
    (a, b) => (REASON_SEVERITY[b] ?? 0) - (REASON_SEVERITY[a] ?? 0),
  )
  const worstReason = sortedCodes[0]
  if (!worstReason) {
    return null
  }
  const thresholds = evaluation.thresholds
  let value: string | undefined
  if (worstReason === 'TREAD_BELOW_LEGAL_MINIMUM') {
    value = formatNumber(thresholds?.ordinaryMinimumMm ?? 1.6)
  } else if (worstReason === 'AT_WINTER_TREAD_INSUFFICIENT') {
    value = formatNumber(thresholds?.legalMinimumMm ?? 4)
  }
  return t(`tyreReport.reasons.${worstReason}`, { value })
}

function formatDotAge(
  dot: Wheel['evaluation']['dot'],
  hasDot: boolean,
  t: TFunction<'workshop', undefined>,
): string {
  if (!dot || !hasDot) return '—'
  if (dot.ageMonths == null) {
    return t('tyreReport.minimumAge', { count: dot.minimumAgeMonths })
  }
  return t('tyreReport.age', { count: dot.ageMonths })
}

function getWheelStatusLabel(
  evaluation: Wheel['evaluation'],
  tEnums: TFunction<'enums', undefined>,
): string {
  if (evaluation.status) {
    return tEnums(`tyreMeasurementStatus.${evaluation.status}`)
  }
  return tEnums(`tyreEvaluationState.${evaluation.state}`)
}

function TyreWheelCard({ wheel, photoUrl }: { wheel: Wheel; photoUrl?: string }) {
  const { t } = useTranslation('workshop')
  const { t: tEnums } = useTranslation('enums')
  const { evaluation } = wheel
  const Icon = evaluation.status ? STATUS_ICONS[evaluation.status] : TriangleAlert
  const position = t(`tyreReport.positions.${wheel.position}`)
  const statusKey = evaluation.status ?? 'NOT_EVALUATED'
  const cardBorderClass = statusClassMap[statusKey] ?? NEUTRAL
  const statusLabel = getWheelStatusLabel(evaluation, tEnums)
  const ageDisplay = formatDotAge(evaluation.dot, Boolean(wheel.dot), t)
  const reasonLine = getWheelReasonLine(wheel, t)

  return (
    <article aria-label={position} className={cn('min-w-0 space-y-3 rounded-md border-2 p-4', cardBorderClass)}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{position}</h3>
        <span className="inline-flex items-center gap-1">
          <Icon className="h-4 w-4" aria-hidden="true" />
          <StatusBadge status={statusKey} label={statusLabel} />
        </span>
      </header>
      <dl className="grid grid-cols-3 gap-2 text-center">
        {POINTS.map((point) => {
          const isWorst = wheel[point] === evaluation.minimumTreadMm
          return (
            <div key={point}>
              <dt className="text-xs text-muted-foreground">{t(`tyreReport.fields.${point}`)}</dt>
              <dd data-worst-point={isWorst ? 'true' : undefined}
                className={cn('tabular-nums', isWorst && 'font-bold underline underline-offset-4')}>
                {wheel[point] == null ? '—' : `${formatNumber(wheel[point])} mm`}
              </dd>
            </div>
          )
        })}
      </dl>
      <dl className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-1 break-words text-sm text-foreground [&>div]:min-w-0">
        {(['brand', 'model', 'size', 'dot'] as const).map((field) => (
          <div key={field} className="min-w-0">
            <dt className="text-muted-foreground">{t(`tyreReport.fields.${field}`)}</dt>
            <dd className="break-words">{wheel[field] || '—'}</dd>
          </div>
        ))}
        <div><dt className="text-muted-foreground">{t('tyreReport.fields.season')}</dt><dd>{t(`tyreReport.seasons.${wheel.season}`)}</dd></div>
        <div><dt className="text-muted-foreground">{t('tyreReport.fields.construction')}</dt><dd>{t(`tyreReport.constructions.${wheel.construction}`)}</dd></div>
        <div><dt className="text-muted-foreground">{t('tyreReport.fields.winterMarking')}</dt><dd>{t(`tyreReport.markings.${wheel.winterMarking}`)}</dd></div>
        <div><dt className="text-muted-foreground">{t('tyreReport.ageLabel')}</dt><dd>{ageDisplay}</dd></div>
      </dl>
      {photoUrl && <img src={photoUrl} alt={t('tyreReport.photo', { position })} className="h-24 w-24 rounded-md object-cover" />}
      {reasonLine && (
        <p className="text-sm font-medium text-foreground">{reasonLine}</p>
      )}
    </article>
  )
}

export function TyreReport({ measurement, mediaUrls = {} }: { measurement: Measurement; mediaUrls?: Record<string, string> }) {
  const { t } = useTranslation('workshop')
  const { t: tEnums } = useTranslation('enums')
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">{t('tyreReport.title')}</h2>
        <StatusBadge status={measurement.worstStatus ?? 'NOT_EVALUATED'} label={measurement.worstStatus
          ? tEnums(`tyreMeasurementStatus.${measurement.worstStatus}`)
          : tEnums('tyreEvaluationState.UNSUPPORTED_COUNTRY')} />
      </div>
      <div data-testid="tyre-wheel-layout" className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div aria-hidden="true" className="mx-auto w-full max-w-40 self-center sm:col-span-2 lg:col-span-1 lg:col-start-2 lg:row-start-1 lg:row-span-2 [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: sketchSvg }} />
        {measurement.wheels.map((wheel) => <div key={wheel.id} className={WHEEL_PLACEMENT[wheel.position]}>
          <TyreWheelCard wheel={wheel} photoUrl={wheel.mediaId ? mediaUrls[wheel.mediaId] : undefined} />
        </div>)}
      </div>
    </div>
  )
}
