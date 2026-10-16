import { useTranslation } from 'react-i18next'
import { GlossaryTerm } from '@/components/glossary/GlossaryTerm'
import { SHELL_GLOSSARY_KEYS } from '@/components/glossary/glossary-keys'
import { cn } from '@/lib/utils'

type ShellGlossaryHintsProps = {
  collapsed: boolean
}

export function ShellGlossaryHints({ collapsed }: ShellGlossaryHintsProps) {
  const { t } = useTranslation('nav')

  if (collapsed) {
    return null
  }

  return (
    <section className="mt-4 border-t border-slate-800 px-3 pt-4" aria-label={t('glossaryHints.sectionLabel')}>
      <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
        {t('glossaryHints.sectionLabel')}
      </p>
      <div className="flex flex-wrap gap-1 px-2">
        {SHELL_GLOSSARY_KEYS.map((term, index) => (
          <span key={term} className="inline-flex items-center gap-1">
            <GlossaryTerm
              term={term}
              className={cn(
                'rounded px-1.5 py-0.5 text-xs font-medium text-slate-300',
                'underline decoration-dotted decoration-slate-500 underline-offset-2',
                'hover:bg-slate-900 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400',
              )}
            />
            {index < SHELL_GLOSSARY_KEYS.length - 1 ? (
              <span className="text-slate-600" aria-hidden="true">·</span>
            ) : null}
          </span>
        ))}
      </div>
    </section>
  )
}
