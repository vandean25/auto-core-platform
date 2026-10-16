import { useState } from 'react'
import { Check, ChevronUp, UserRound } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useUiLanguage, type UiLanguage } from '@/lib/i18n'
import { useTranslation } from 'react-i18next'

type ProfileLanguageMenuProps = {
  userEmail: string | null
  collapsed: boolean
  onSignOut: () => void
}

export function ProfileLanguageMenu({ userEmail, collapsed, onSignOut }: ProfileLanguageMenuProps) {
  const { t } = useTranslation('common')
  const { language, setLanguage, isSwitching, switchError, labels } = useUiLanguage()
  const [menuOpen, setMenuOpen] = useState(false)

  const chooseLanguage = async (next: UiLanguage, event: Event) => {
    event.preventDefault()
    await setLanguage(next)
  }

  return (
    <div className="space-y-1">
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className={cn(
              'text-slate-300 hover:bg-slate-900 hover:text-white',
              collapsed ? 'h-10 w-full justify-center px-0' : 'h-10 w-full justify-start gap-3 px-3',
            )}
            aria-label={t('profile.menuLabel')}
            title={userEmail ?? t('profile.menuLabel')}
            aria-describedby={switchError ? 'profile-language-error' : undefined}
          >
            <UserRound aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span className={cn('truncate text-left', collapsed ? 'sr-only' : 'flex-1')}>
              {userEmail ?? t('profile.menuLabel')}
            </span>
            {!collapsed ? <ChevronUp aria-hidden="true" className="ml-auto h-3.5 w-3.5 shrink-0 opacity-70" /> : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-56">
          <DropdownMenuLabel>{labels.section}</DropdownMenuLabel>
          <DropdownMenuItem
            disabled={isSwitching}
            onSelect={(event) => void chooseLanguage('de', event)}
            data-testid="language-option-de"
          >
            <span className="flex-1">{labels.de}</span>
            {language === 'de' ? <Check aria-hidden="true" className="h-4 w-4" /> : null}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isSwitching}
            onSelect={(event) => void chooseLanguage('en', event)}
            data-testid="language-option-en"
          >
            <span className="flex-1">{labels.en}</span>
            {language === 'en' ? <Check aria-hidden="true" className="h-4 w-4" /> : null}
          </DropdownMenuItem>
          {isSwitching ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">{labels.pending}</p>
          ) : null}
          {switchError ? (
            <p className="px-2 py-1.5 text-xs text-destructive" role="alert">{labels.error}</p>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onSignOut}>{t('profile.signOut')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {switchError ? (
        <p
          id="profile-language-error"
          className={cn(
            'text-xs text-red-400',
            collapsed ? 'px-1 text-center' : 'px-3',
          )}
          role="alert"
        >
          {labels.error}
        </p>
      ) : null}
    </div>
  )
}
