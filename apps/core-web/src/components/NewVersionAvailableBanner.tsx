import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppVersionUpdate } from '@/hooks/useAppVersionUpdate'

export function NewVersionAvailableBanner() {
  const { updateAvailable, reload } = useAppVersionUpdate()

  if (!updateAvailable) {
    return null
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-950 shadow-sm"
    >
      <span>New version available</span>
      <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={reload}>
        <RefreshCw className="size-3.5" aria-hidden />
        Reload
      </Button>
    </div>
  )
}
