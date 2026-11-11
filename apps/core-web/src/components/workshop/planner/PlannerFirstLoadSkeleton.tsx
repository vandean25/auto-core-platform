import { Skeleton } from '@/components/ui/skeleton'

export function PlannerFirstLoadSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  )
}
