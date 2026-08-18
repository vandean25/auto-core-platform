import { Plus } from 'lucide-react'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { MechanicTaskDetail } from '@/api/mechanic'

type PartLine = MechanicTaskDetail['lineItems'][number]

type PartsSectionProps = {
  partItems: PartLine[]
  isDone: boolean
  onRequestPart: () => void
}

export function PartsSection({ partItems, isDone, onRequestPart }: PartsSectionProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Parts</CardTitle>
          {!isDone && (
            <Button size="sm" variant="outline" className="min-h-[36px] gap-1" onClick={onRequestPart}>
              <Plus className="h-3.5 w-3.5" />
              Request Part
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {partItems.length === 0 ? (
          <p className="text-sm text-slate-400">No parts requested yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {partItems.map((lineItem) => (
              <li key={lineItem.id} className="flex items-center justify-between py-3">
                <span className="text-sm font-medium">{lineItem.description}</span>
                <div className="flex items-center gap-3 ml-4 shrink-0">
                  <span className="text-sm text-slate-500">qty {lineItem.qty}</span>
                  {lineItem.partExecutionStatus && (
                    <StatusBadge status={lineItem.partExecutionStatus} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
