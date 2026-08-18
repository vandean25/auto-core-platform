import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { MechanicTaskDetail } from '@/api/mechanic'

type LaborLine = MechanicTaskDetail['lineItems'][number]

export function LaborItemsCard({ laborItems }: { laborItems: LaborLine[] }) {
  if (laborItems.length === 0) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Labour</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-slate-100">
          {laborItems.map((lineItem) => (
            <li key={lineItem.id} className="flex items-center justify-between py-3">
              <span className="text-sm font-medium">{lineItem.description}</span>
              <span className="text-sm text-slate-500 ml-4 shrink-0">
                {lineItem.qty} {lineItem.qty === 1 ? 'hr' : 'hrs'}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
