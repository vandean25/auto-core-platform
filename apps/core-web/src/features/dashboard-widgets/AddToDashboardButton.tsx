import * as React from 'react'
import { Star } from 'lucide-react'
import { useLocation } from 'react-router-dom'
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
    setName(`${source.sourceLabel} Widget`)
    setDisplayType('list')
    setGroupByField(categoricalFields[0]?.key ?? '')
    setMetricCalculation('count')
    setMetricField(numericFields[0]?.key ?? '')
  }, [open, source.sourceLabel, categoricalFields, numericFields])

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-2">
        <Star className="h-4 w-4" />
        Add to Dashboard
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Widget to Dashboard</DialogTitle>
            <DialogDescription>Configure how this saved filter should appear on your dashboard.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Widget Name</label>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Orders by Status" />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Display Type</label>
              <Select value={displayType} onValueChange={(value) => setDisplayType(value as DashboardWidgetDisplayType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="list">List</SelectItem>
                  <SelectItem value="donut">Donut Chart</SelectItem>
                  <SelectItem value="metric">Metric Card</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {displayType === 'donut' ? (
              <div className="space-y-2">
                <label className="text-sm font-medium">Group By</label>
                <Select value={groupByField} onValueChange={setGroupByField}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select grouping column" />
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
                  <label className="text-sm font-medium">Calculate</label>
                  <Select
                    value={metricCalculation}
                    onValueChange={(value) => setMetricCalculation(value as DashboardWidgetMetricCalculation)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="count">Count (Total Items)</SelectItem>
                      <SelectItem value="sum">Sum (Numbers / Currency)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {metricCalculation === 'sum' ? (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Sum Column</label>
                    <Select value={metricField} onValueChange={setMetricField}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select numeric column" />
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
              Cancel
            </Button>
            <Button
              onClick={() => {
                const trimmedName = name.trim()
                if (!trimmedName) {
                  toast.error('Widget name is required.')
                  return
                }
                if (displayType === 'donut' && !groupByField) {
                  toast.error('Select a Group By field.')
                  return
                }
                if (displayType === 'metric' && metricCalculation === 'sum' && !metricField) {
                  toast.error('Select a column to sum.')
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

                toast.success('Widget added to dashboard.')
                setOpen(false)
              }}
            >
              Add Widget
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

