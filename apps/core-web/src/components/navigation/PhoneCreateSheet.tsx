import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { getGlobalSearchQuickActionSections } from '@/components/global-search/global-search-quick-actions-data'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

type PhoneCreateSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  activeRole: string | null
}

/** The phone "Create" button: the same role-gated create entries Cmd+K offers. */
export function PhoneCreateSheet({ open, onOpenChange, activeRole }: PhoneCreateSheetProps) {
  const { t } = useTranslation('nav')
  const navigate = useNavigate()
  const items = getGlobalSearchQuickActionSections(null, activeRole ?? undefined).flatMap((section) => section.items)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" aria-describedby={undefined} className="max-h-[85dvh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t('phoneNav.createTitle')}</SheetTitle>
        </SheetHeader>
        <ul className="mt-4 space-y-1">
          {items.map((item) => (
            <li key={item.href}>
              <button
                type="button"
                className="flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  onOpenChange(false)
                  navigate(item.href)
                }}
              >
                <item.icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>
                  <span className="block font-medium">{item.label}</span>
                  <span className="block text-xs text-muted-foreground">{item.description}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  )
}
