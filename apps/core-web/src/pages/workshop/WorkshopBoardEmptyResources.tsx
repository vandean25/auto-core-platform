import { useNavigate } from 'react-router-dom'
import { Wrench } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { BoardViewMode } from '@/components/workshop/BoardViewToggle'

export function WorkshopBoardEmptyResources({ mode }: { mode: BoardViewMode }) {
  const navigate = useNavigate()
  const tab = mode === 'mechanic' ? 'employees' : 'bays'
  const label = mode === 'mechanic' ? 'Mechanics' : 'Bays'

  return (
    <Card className="max-w-sm mx-auto mt-8">
      <CardHeader className="items-center pb-2">
        <div className="rounded-full bg-slate-100 p-3 mb-2">
          <Wrench className="h-6 w-6 text-slate-400" />
        </div>
        <CardTitle className="text-base text-center">No {label} configured</CardTitle>
        <CardDescription className="text-center">
          Add {label.toLowerCase()} in Settings to start assigning workshop orders.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center pt-0">
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate(`/settings?tab=${tab}`)}
        >
          Go to Settings
        </Button>
      </CardContent>
    </Card>
  )
}
