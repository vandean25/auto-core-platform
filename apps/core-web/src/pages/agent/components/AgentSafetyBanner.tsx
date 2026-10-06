import { ShieldAlert } from 'lucide-react'
import type { Language } from '../agent-supervision-copy'
import { getCopy, SUPERVISION_COPY } from '../agent-supervision-copy'

interface AgentSafetyBannerProps {
  language?: Language
}

export function AgentSafetyBanner({ language = 'en' }: AgentSafetyBannerProps) {
  const t = SUPERVISION_COPY.banner

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900 shadow-sm"
      data-testid="agent-safety-banner"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
        <ShieldAlert className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold tracking-tight">
            {getCopy(t.title, language)}
          </h2>
          <span className="rounded bg-amber-200 px-2 py-0.5 text-xs font-medium text-amber-800">
            {getCopy(t.badge, language)}
          </span>
        </div>
        <p className="text-sm text-amber-800/90 leading-relaxed">
          {getCopy(t.description, language)}
        </p>
      </div>
    </div>
  )
}
