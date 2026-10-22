import { createContext, useContext } from 'react'
import { Rows3 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

export type DataTableDensity = 'normal' | 'compact'

type DensityContextValue = { density: DataTableDensity; setDensity: (density: DataTableDensity) => void }

/** Lets the toolbar toggle row density without every toolbar caller passing it down. */
export const DataTableDensityContext = createContext<DensityContextValue | null>(null)

export function DataTableDensityToggle() {
  const { t } = useTranslation('common')
  const context = useContext(DataTableDensityContext)
  if (!context) return null

  const isCompact = context.density === 'compact'

  return (
    <Button
      variant={isCompact ? 'secondary' : 'outline'}
      size="sm"
      className="h-8"
      aria-pressed={isCompact}
      aria-label={t('dataTable.density.compact')}
      title={t('dataTable.density.compact')}
      onClick={() => context.setDensity(isCompact ? 'normal' : 'compact')}
    >
      <Rows3 className="h-4 w-4" />
    </Button>
  )
}
