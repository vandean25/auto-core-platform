import { Loader2 } from 'lucide-react'
import type { SaveState } from '../types'

export function SaveStateIndicator({ state }: { state: SaveState }) {
  if (state === 'idle') return null
  return (
    <span
      className={`text-xs font-medium ${
        state === 'saving'
          ? 'text-slate-400'
          : state === 'saved'
            ? 'text-emerald-600'
            : 'text-red-500'
      }`}
    >
      {state === 'saving' && (
        <span className="inline-flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Saving…
        </span>
      )}
      {state === 'saved' && 'Saved ✓'}
      {state === 'error' && 'Error — not saved'}
    </span>
  )
}
