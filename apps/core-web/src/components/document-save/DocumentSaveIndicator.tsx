import { AlertCircle, CloudCheck, Loader2 } from 'lucide-react'
import type { DocumentSaveStatus } from '@/hooks/useDebouncedAutoSave'

export function DocumentSaveIndicator({ status }: { status: DocumentSaveStatus }) {
  if (status === 'idle') return null

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-[140px] justify-end">
      {status === 'saving' && (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Saving...</span>
        </>
      )}
      {status === 'saved' && (
        <>
          <CloudCheck className="h-3.5 w-3.5 text-green-600" />
          <span>All changes saved</span>
        </>
      )}
      {status === 'error' && (
        <>
          <AlertCircle className="h-3.5 w-3.5 text-red-600" />
          <span className="text-red-600 font-medium">Save failed</span>
        </>
      )}
    </div>
  )
}
