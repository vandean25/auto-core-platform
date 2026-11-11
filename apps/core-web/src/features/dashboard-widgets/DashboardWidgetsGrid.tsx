import { useTranslation } from 'react-i18next'
import { selectEffectiveCapabilities, useAuthSession } from '@/api/auth-session'
import { Info, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useDashboardWidgets } from '@/features/dashboard-widgets/DashboardWidgetsProvider'
import type { DashboardWidgetTableSource } from '@/features/dashboard-widgets/types'
import { DashboardWidgetCard } from '@/features/dashboard-widgets/DashboardWidgetCard'

const PICKERL_DUE_SOURCE_KEY = 'pickerl-due'

type DashboardWidgetsGridProps = {
  sourcesByKey: Record<string, DashboardWidgetTableSource>
}

export function DashboardWidgetsGrid({ sourcesByKey }: DashboardWidgetsGridProps) {
  const { t } = useTranslation('common')
  const { widgets, removeWidget } = useDashboardWidgets()
  const capabilities = selectEffectiveCapabilities(useAuthSession().data)
  const visibleWidgets = widgets.filter((widget) => widget.sourceKey !== PICKERL_DUE_SOURCE_KEY || capabilities?.pickerl57a === true)

  if (widgets.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-1.5">
            <p className="text-sm text-muted-foreground">{t('dashboard.emptyWidgets')}</p>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 sm:h-5 sm:w-5 text-muted-foreground hover:text-foreground"
                  aria-label={t('dashboard.emptyWidgetsInfoAria')}
                >
                  <Info className="h-3.5 w-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 text-xs text-muted-foreground" aria-label={t('dashboard.emptyWidgetsInfoAria')}>
                {t('dashboard.emptyWidgetsHint')}
              </PopoverContent>
            </Popover>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 dashboard-widgets-grid">
      {visibleWidgets.map((widget) => {
        const source = sourcesByKey[widget.sourceKey]
        if (!source) {
          return (
            <Card key={widget.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
                <CardTitle className="text-base font-semibold">{widget.name}</CardTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeWidget(widget.id)}
                  aria-label={t('dashboard.removeWidgetAria', { name: widget.name })}
                >
                  <X className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{t('dashboard.sourceUnavailable')}</p>
              </CardContent>
            </Card>
          )
        }
        return (
          <DashboardWidgetCard
            key={widget.id}
            widget={widget}
            source={source}
            onRemove={() => removeWidget(widget.id)}
          />
        )
      })}
    </div>
  )
}
