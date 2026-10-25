import { useTranslation } from 'react-i18next'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/kbd'

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }
  return /Mac|iPhone|iPad/.test(navigator.userAgent)
}

type ShortcutRowProps = {
  keys: string[]
  label: string
}

function ShortcutRow({ keys, label }: ShortcutRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span className="text-sm text-foreground">{label}</span>
      <div className="flex shrink-0 items-center gap-1">
        {keys.map((keyLabel) => (
          <Kbd key={keyLabel}>{keyLabel}</Kbd>
        ))}
      </div>
    </div>
  )
}

type KeyboardShortcutsOverlayProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function KeyboardShortcutsOverlay({
  open,
  onOpenChange,
}: KeyboardShortcutsOverlayProps) {
  const { t } = useTranslation('common')
  const mod = isMacPlatform() ? '⌘' : 'Ctrl'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('shortcuts.title')}</DialogTitle>
          <DialogDescription>{t('shortcuts.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('shortcuts.sections.global')}
            </h3>
            <ShortcutRow
              keys={[mod, 'K']}
              label={t('shortcuts.entries.globalSearch')}
            />
            <ShortcutRow
              keys={[mod, 'B']}
              label={t('shortcuts.entries.toggleSidebar')}
            />
            <ShortcutRow keys={['?']} label={t('shortcuts.entries.showHelp')} />
          </section>
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('shortcuts.sections.navigation')}
            </h3>
            <ShortcutRow
              keys={['G', 'W']}
              label={t('shortcuts.entries.goWorkshopOrders')}
            />
            <ShortcutRow keys={['G', 'C']} label={t('shortcuts.entries.goCustomers')} />
            <ShortcutRow keys={['G', 'V']} label={t('shortcuts.entries.goVehicles')} />
          </section>
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('shortcuts.sections.lists')}
            </h3>
            <ShortcutRow keys={['O']} label={t('shortcuts.entries.rowOpenDetail')} />
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
