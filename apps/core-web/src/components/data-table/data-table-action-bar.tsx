import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

interface DataTableActionBarProps {
  selectedCount: number
  onClear: () => void
  /** Offered while loaded rows are left unselected; the count is the loaded rows, never the whole result. */
  selectAllLoaded?: { count: number; onSelect: () => void }
  children: ReactNode
}

/** Floating bar shown while rows are selected; the caller's bulk actions dock here. */
export function DataTableActionBar({ selectedCount, onClear, selectAllLoaded, children }: DataTableActionBarProps) {
  const { t } = useTranslation('common')

  return (
    <div
      role="toolbar"
      aria-label={t('dataTable.actionBar.label')}
      className="fixed inset-x-4 bottom-[calc(var(--phone-nav-h)+1.5rem)] z-40 mx-auto flex w-fit max-w-full flex-wrap items-center gap-2 rounded-lg border bg-popover p-2 text-popover-foreground shadow-lg"
    >
      <span className="px-2 text-sm font-medium tabular-nums">{t('dataTable.actionBar.selected', { count: selectedCount })}</span>
      {selectAllLoaded ? (
        <Button variant="ghost" size="sm" className="min-h-11 md:min-h-8" onClick={selectAllLoaded.onSelect}>
          {t('dataTable.actionBar.selectAllLoaded', { count: selectAllLoaded.count })}
        </Button>
      ) : null}
      {children}
      <Button variant="ghost" size="icon" className="size-11 md:size-8" aria-label={t('dataTable.actionBar.clear')} onClick={onClear}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}
