import { BookOpen, Check, ExternalLink, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenu, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar'
import { DOCUMENTATION_URL } from '@/lib/external-links'
import { useUiLanguage, type UiLanguage } from '@/lib/i18n'
import { SidebarDropdownButton } from './SidebarDropdownButton'

type NavUserProps = {
  userEmail: string | null
  onSignOut: () => void
}

/** Two letters from the email address for the avatar, such as "JD" for "jane.doe@…". */
function initialsFor(email: string | null) {
  const [localPart = ''] = (email ?? '').split('@')
  const parts = localPart.split(/[._-]+/).filter(Boolean)
  const letters = parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : localPart.slice(0, 2)
  return letters.toUpperCase()
}

/** Account menu in the sidebar footer: UI language, help and sign out. */
export function NavUser({ userEmail, onSignOut }: NavUserProps) {
  const { t } = useTranslation('nav')
  const { t: tCommon } = useTranslation('common')
  const { isMobile } = useSidebar()
  const { language, setLanguage, isSwitching, switchError, labels } = useUiLanguage()
  const initials = initialsFor(userEmail)
  const accountLabel = userEmail ?? tCommon('profile.menuLabel')

  const chooseLanguage = async (next: UiLanguage, event: Event) => {
    // Keep the menu open while the language switches.
    event.preventDefault()
    await setLanguage(next)
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarDropdownButton
              icon={initials ? initials : <UserRound />}
              title={accountLabel}
              tooltip={accountLabel}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            side={isMobile ? 'bottom' : 'right'}
            sideOffset={4}
            className="min-w-56 rounded-lg"
          >
            <DropdownMenuLabel>{labels.section}</DropdownMenuLabel>
            <DropdownMenuItem
              disabled={isSwitching}
              onSelect={(event) => void chooseLanguage('de', event)}
              data-testid="language-option-de"
            >
              <span className="flex-1">{labels.de}</span>
              {language === 'de' ? <Check aria-hidden="true" /> : null}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={isSwitching}
              onSelect={(event) => void chooseLanguage('en', event)}
              data-testid="language-option-en"
            >
              <span className="flex-1">{labels.en}</span>
              {language === 'en' ? <Check aria-hidden="true" /> : null}
            </DropdownMenuItem>
            {isSwitching ? <p className="px-2 py-1.5 text-xs text-muted-foreground">{labels.pending}</p> : null}
            {switchError ? (
              <p role="alert" className="px-2 py-1.5 text-xs text-destructive">
                {labels.error}
              </p>
            ) : null}

            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a
                href={DOCUMENTATION_URL}
                target="_blank"
                rel="noopener noreferrer"
                title={t('user.helpDocsOpensNewTab')}
              >
                <BookOpen aria-hidden="true" />
                <span className="flex-1">{t('user.helpDocs')}</span>
                <ExternalLink aria-hidden="true" className="text-muted-foreground" />
              </a>
            </DropdownMenuItem>

            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onSignOut}>{tCommon('profile.signOut')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
