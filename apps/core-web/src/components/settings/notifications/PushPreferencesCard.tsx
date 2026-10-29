import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  PUSH_USER_EVENT_TYPES,
  usePushPreferences,
  useUpdatePushPreferences,
  type PushPreferences,
  type PushUserEventType,
} from '@/api/push'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { TimeField } from '@/components/ui/time-field'
import { minutesToTime, timeToMinutes } from '@/features/push/quiet-hours'

const DEFAULT_QUIET_START = '22:00'
const DEFAULT_QUIET_END = '06:00'

/** Which events send a push, and the quiet hours. Event toggles save at once; the quiet hours have a save button. */
export function PushPreferencesCard() {
  const { t } = useTranslation(['settings', 'common'])
  const { data } = usePushPreferences()
  const update = useUpdatePushPreferences()
  const [quietOn, setQuietOn] = React.useState(false)
  const [start, setStart] = React.useState(DEFAULT_QUIET_START)
  const [end, setEnd] = React.useState(DEFAULT_QUIET_END)

  React.useEffect(() => {
    if (!data) return
    setQuietOn(data.quietStartMin !== null && data.quietEndMin !== null)
    setStart(minutesToTime(data.quietStartMin) || DEFAULT_QUIET_START)
    setEnd(minutesToTime(data.quietEndMin) || DEFAULT_QUIET_END)
  }, [data])

  const save = async (next: PushPreferences, success?: string, failure?: string) => {
    try {
      await update.mutateAsync(next)
      if (success) toast.success(success)
    } catch {
      toast.error(failure ?? t('notifications.events.saveFailed'))
    }
  }

  const toggleEvent = (event: PushUserEventType, checked: boolean) => {
    if (!data) return
    const enabledEvents = checked
      ? [...data.enabledEvents, event]
      : data.enabledEvents.filter((current) => current !== event)
    return save({ ...data, enabledEvents })
  }

  const startMin = timeToMinutes(start)
  const endMin = timeToMinutes(end)
  const quietValid = !quietOn || (startMin !== null && endMin !== null && startMin !== endMin)

  const saveQuietHours = () => {
    if (!data || !quietValid) return
    return save(
      { ...data, quietStartMin: quietOn ? startMin : null, quietEndMin: quietOn ? endMin : null },
      t('notifications.quietHours.saved'),
      t('notifications.quietHours.saveFailed'),
    )
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('notifications.events.title')}</CardTitle>
          <CardDescription>{t('notifications.events.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {PUSH_USER_EVENT_TYPES.map((event) => (
            <div key={event} className="flex min-h-11 items-start gap-3">
              <Checkbox
                id={`push-event-${event}`}
                checked={data?.enabledEvents.includes(event) ?? false}
                disabled={!data || update.isPending}
                onCheckedChange={(checked) => void toggleEvent(event, checked === true)}
              />
              <Label htmlFor={`push-event-${event}`} className="grid gap-1 font-normal">
                <span className="font-medium">{t(`notifications.events.${event}.label`)}</span>
                <span className="text-slate-500">{t(`notifications.events.${event}.hint`)}</span>
              </Label>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('notifications.quietHours.title')}</CardTitle>
          <CardDescription>{t('notifications.quietHours.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex min-h-11 items-center gap-3">
            <Checkbox
              id="push-quiet-hours"
              checked={quietOn}
              disabled={!data}
              onCheckedChange={(checked) => setQuietOn(checked === true)}
            />
            <Label htmlFor="push-quiet-hours" className="font-normal">
              {t('notifications.quietHours.enabled')}
            </Label>
          </div>
          {quietOn ? (
            <div className="flex flex-wrap items-end gap-3">
              <div className="grid gap-1">
                <Label htmlFor="push-quiet-start">{t('notifications.quietHours.from')}</Label>
                <TimeField id="push-quiet-start" value={start} onChange={setStart} className="min-h-11 w-28" />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="push-quiet-end">{t('notifications.quietHours.to')}</Label>
                <TimeField id="push-quiet-end" value={end} onChange={setEnd} className="min-h-11 w-28" />
              </div>
            </div>
          ) : null}
          <Button className="min-h-11" disabled={!data || !quietValid || update.isPending} onClick={saveQuietHours}>
            {t('common:actions.save')}
          </Button>
        </CardContent>
      </Card>
    </>
  )
}
