import { useTranslation } from 'react-i18next'
import { GlossaryTerm } from '@/components/glossary/GlossaryTerm'
import { SHELL_GLOSSARY_KEYS } from '@/components/glossary/glossary-keys'
import { SidebarGroup, SidebarGroupContent } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

/** Glossary terms at the bottom of the sidebar. Icon mode has no room for them, so they hide there. */
export function ShellGlossaryHints() {
  const { t } = useTranslation('nav')

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <p className="flex h-8 items-center px-2 text-xs font-medium text-sidebar-foreground">
        {t('glossaryHints.sectionLabel')}
      </p>
      <SidebarGroupContent className="flex flex-wrap items-center gap-1 px-2">
        {SHELL_GLOSSARY_KEYS.map((term, index) => (
          <span key={term} className="inline-flex items-center gap-1">
            <GlossaryTerm
              term={term}
              className={cn(
                'rounded-sm px-1 py-0.5 text-xs font-medium text-sidebar-foreground',
                'underline decoration-dotted underline-offset-2',
                'hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-hidden',
              )}
            />
            {index < SHELL_GLOSSARY_KEYS.length - 1 ? (
              <span className="text-sidebar-foreground" aria-hidden="true">
                ·
              </span>
            ) : null}
          </span>
        ))}
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
