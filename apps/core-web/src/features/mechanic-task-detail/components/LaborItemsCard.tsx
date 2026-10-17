import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { MechanicTaskDetail } from '@/api/mechanic'

type LaborLine = MechanicTaskDetail['lineItems'][number]

export function LaborItemsCard({ laborItems }: { laborItems: LaborLine[] }) {
  const { t } = useTranslation('workshop')
  if (laborItems.length === 0) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t('mechanic.taskDetail.labor.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-slate-100">
          {laborItems.map((lineItem) => (
            <li key={lineItem.id} className="flex items-center justify-between py-3">
              <span className="text-sm font-medium">
                {lineItem.itemNo ? `${lineItem.itemNo} · ${lineItem.description}` : lineItem.description}
              </span>
              <span className="text-sm text-slate-500 ml-4 shrink-0">
                {t('mechanic.taskDetail.labor.hours', { count: lineItem.qty })}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
