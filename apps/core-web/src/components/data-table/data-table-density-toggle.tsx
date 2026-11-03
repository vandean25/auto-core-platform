import { createContext, useContext } from 'react'
import { useTranslation } from 'react-i18next'

import { DropdownMenuCheckboxItem } from '@/components/ui/dropdown-menu'
import type { DataTableDensity } from '@/lib/density-tokens'

type DensityContextValue = { density: DataTableDensity; setDensity: (density: DataTableDensity) => void }

/** Lets the Columns menu switch row density without every toolbar caller passing it down. */
export const DataTableDensityContext = createContext<DensityContextValue | null>(null)

// A menu item, not a toolbar button: an extra button pushed the toolbar past the viewport at tablet width.
export function DataTableDensityMenuItem() {
  const { t } = useTranslation('common')
  const context = useContext(DataTableDensityContext)
  if (!context) return null

  return (
    <DropdownMenuCheckboxItem
      checked={context.density === 'compact'}
      onCheckedChange={(checked) => context.setDensity(checked ? 'compact' : 'comfortable')}
      onSelect={(event) => event.preventDefault()}
    >
      {t('dataTable.density.compact')}
    </DropdownMenuCheckboxItem>
  )
}
