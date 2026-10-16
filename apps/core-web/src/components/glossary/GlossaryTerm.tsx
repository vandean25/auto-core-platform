import { useTranslation } from 'react-i18next'
import { TooltipHint } from '@/components/ui/tooltip'
import type { ShellGlossaryKey } from './glossary-keys'

type GlossaryTermProps = {
  term: ShellGlossaryKey
  className?: string
}

export function GlossaryTerm({ term, className }: GlossaryTermProps) {
  const { t } = useTranslation('glossary')
  const description = t(`${term}.description`)
  const shortLabel = t(`${term}.short`)

  return (
    <TooltipHint hint={description}>
      <button
        type="button"
        className={className}
        data-testid={`glossary-term-${term}`}
        aria-label={`${shortLabel}: ${description}`}
      >
        {shortLabel}
      </button>
    </TooltipHint>
  )
}
