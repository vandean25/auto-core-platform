import * as React from 'react'
import { Star } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TooltipHint } from '@/components/ui/tooltip'
import { useDashboardWidgets } from '@/features/dashboard-widgets/DashboardWidgetsProvider'
import type {
  DashboardWidgetDisplayType,
  DashboardWidgetMetricCalculation,
  DashboardWidgetTableSource,
} from '@/features/dashboard-widgets/types'

type AddToDashboardButtonProps = {
  source: DashboardWidgetTableSource
}

export function AddToDashboardButton({ source }: AddToDashboardButtonProps) {
  const { t } = useTranslation('common')
  const location = useLocation()
  const { addWidget } = useDashboardWidgets()
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const [displayType, setDisplayType] = React.useState<DashboardWidgetDisplayType>('list')
  const [groupByField, setGroupByField] = React.useState('')
  const [metricCalculation, setMetricCalculation] = React.useState<DashboardWidgetMetricCalculation>('count')
  const [metricField, setMetricField] = React.useState('')

  const categoricalFields = React.useMemo(
    () => source.fields.filter((field) => field.type === 'categorical'),
    [source.fields],
  )
  const numericFields = React.useMemo(
    () => source.fields.filter((field) => field.type === 'number' || field.type === 'currency'),
    [source.fields],
  )

  React.useEffect(() => {
    if (!open) return
    setName(t('dashboard.defaultWidgetName', { sourceLabel: source.sourceLabel }))
    setDisplayType('list')
    setGroupByField(categoricalFields[0]?.key ?? '')
    setMetricCalculation('count')
    setMetricField(numericFields[0]?.key ?? '')
  }, [open, source.sourceLabel, categoricalFields, numericFields, t])

  return (
    <>
      <TooltipHint hint={t('dashboard.addToDashboardHint')}>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-2">
          <Star className="h-4 w-4" />
          {t('dashboard.addToDashboard')}
        </Button>
      </TooltipHint>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('dashboard.addWidgetTitle')}</DialogTitle>
            <DialogDescription>{t('dashboard.addWidgetDescription')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="dashboard-widget-name" className="text-sm font-medium">{t('dashboard.widgetName')}</label>
              <Input id="dashboard-widget-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={t('dashboard.widgetNamePlaceholder')} />
            </div>

            <div className="space-y-2">
              <label htmlFor="dashboard-widget-display-type" className="text-sm font-medium">{t('dashboard.displayType')}</label>
              <Select value={displayType} onValueChange={(value) => setDisplayType(value as DashboardWidgetDisplayType)}>
                <SelectTrigger id="dashboard-widget-display-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="list">{t('dashboard.displayList')}</SelectItem>
                  <SelectItem value="donut">{t('dashboard.displayDonut')}</SelectItem>
                  <SelectItem value="metric">{t('dashboard.displayMetric')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {displayType === 'donut' ? (
              <div className="space-y-2">
                <label htmlFor="dashboard-widget-group-by" className="text-sm font-medium">{t('dashboard.groupBy')}</label>
                <Select value={groupByField} onValueChange={setGroupByField}>
                  <SelectTrigger id="dashboard-widget-group-by">
                    <SelectValue placeholder={t('dashboard.groupByPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {categoricalFields.map((field) => (
                      <SelectItem key={field.key} value={field.key}>
                        {field.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {displayType === 'metric' ? (
              <div className="space-y-3">
                <div className="space-y-2">
                  <label htmlFor="dashboard-widget-calculation" className="text-sm font-medium">{t('dashboard.calculate')}</label>
                  <Select
                    value={metricCalculation}
                    onValueChange={(value) => setMetricCalculation(value as DashboardWidgetMetricCalculation)}
                  >
                    <SelectTrigger id="dashboard-widget-calculation">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="count">{t('dashboard.calculateCount')}</SelectItem>
                      <SelectItem value="sum">{t('dashboard.calculateSum')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {metricCalculation === 'sum' ? (
                  <div className="space-y-2">
                  <label htmlFor="dashboard-widget-metric-field" className="text-sm font-medium">{t('dashboard.sumColumn')}</label>
                  <Select value={metricField} onValueChange={setMetricField}>
                    <SelectTrigger id="dashboard-widget-metric-field">
                        <SelectValue placeholder={t('dashboard.sumColumnPlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {numericFields.map((field) => (
                          <SelectItem key={field.key} value={field.key}>
                            {field.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t('actions.cancel')}
            </Button>
            <Button
              onClick={() => {
                const trimmedName = name.trim()
                if (!trimmedName) {
                  toast.error(t('dashboard.widgetNameRequired'))
                  return
                }
                if (displayType === 'donut' && !groupByField) {
                  toast.error(t('dashboard.groupByRequired'))
                  return
                }
                if (displayType === 'metric' && metricCalculation === 'sum' && !metricField) {
                  toast.error(t('dashboard.sumColumnRequired'))
                  return
                }

                addWidget({
                  name: trimmedName,
                  sourceKey: source.sourceKey,
                  sourceLabel: source.sourceLabel,
                  href: `${location.pathname}${location.search}`,
                  displayType,
                  groupByField: displayType === 'donut' ? groupByField : undefined,
                  metricCalculation: displayType === 'metric' ? metricCalculation : undefined,
                  metricField: displayType === 'metric' && metricCalculation === 'sum' ? metricField : undefined,
                })

                toast.success(t('dashboard.widgetAdded'))
                setOpen(false)
              }}
            >
              {t('dashboard.addToDashboard')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
