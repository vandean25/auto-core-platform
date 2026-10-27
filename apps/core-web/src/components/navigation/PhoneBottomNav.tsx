import type { LucideIcon } from 'lucide-react'
import { Plus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

export type PhoneNavEntry = {
  id: string
  label: string
  icon: LucideIcon
  to?: string
  onSelect?: () => void
  active?: boolean
  disabled?: boolean
}

const slotClassName =
  'flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'

function PhoneNavSlot({ entry }: { entry: PhoneNavEntry }) {
  const className = cn(slotClassName, entry.active ? 'text-primary' : 'text-muted-foreground')
  const content = (
    <>
      <entry.icon className="size-5" aria-hidden="true" />
      <span className="max-w-full truncate">{entry.label}</span>
    </>
  )

  return entry.to ? (
    <Link to={entry.to} className={className} aria-current={entry.active ? 'page' : undefined}>
      {content}
    </Link>
  ) : (
    <button type="button" className={className} disabled={entry.disabled} onClick={entry.onSelect}>
      {content}
    </button>
  )
}

type PhoneBottomNavProps = {
  /** Slots left of the central create button. */
  start: PhoneNavEntry[]
  create: { label: string; onSelect: () => void; disabled?: boolean }
  /** Slots right of the central create button. */
  end: PhoneNavEntry[]
}

/**
 * Fixed bar below md (768px). Pages reserve its height through `--phone-nav-h`, which index.css sets
 * only while a `[data-phone-nav]` element is mounted.
 */
export function PhoneBottomNav({ start, create, end }: PhoneBottomNavProps) {
  const { t } = useTranslation('nav')

  return (
    <nav
      aria-label={t('phoneNav.aria')}
      data-phone-nav="true"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background pb-[env(safe-area-inset-bottom,0px)] md:hidden"
    >
      <div className="flex h-14 items-center px-[env(safe-area-inset-left,0px)]">
        {start.map((entry) => (
          <PhoneNavSlot key={entry.id} entry={entry} />
        ))}
        <div className="flex flex-1 justify-center">
          <button
            type="button"
            aria-label={create.label}
            disabled={create.disabled}
            onClick={create.onSelect}
            className="flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
          >
            <Plus className="size-5" aria-hidden="true" />
          </button>
        </div>
        {end.map((entry) => (
          <PhoneNavSlot key={entry.id} entry={entry} />
        ))}
      </div>
    </nav>
  )
}
