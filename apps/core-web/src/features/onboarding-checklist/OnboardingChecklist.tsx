import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { useAuthSession } from '@/api/auth-session'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ONBOARDING_CHECKLIST_ROLES, ONBOARDING_CHECKLIST_STEPS } from './onboarding-checklist-config'
import { isOnboardingChecklistDismissed, markOnboardingChecklistDismissed } from './onboarding-checklist-storage'

export function OnboardingChecklist() {
  const { data: session } = useAuthSession()

  if (!session || !ONBOARDING_CHECKLIST_ROLES.includes(session.activeRole)) {
    return null
  }

  return <OnboardingChecklistCard key={session.userId} userId={session.userId} />
}

function OnboardingChecklistCard({ userId }: { userId: string }) {
  const { t } = useTranslation('common')
  const [dismissed, setDismissed] = useState(() => isOnboardingChecklistDismissed(userId))

  if (dismissed) {
    return null
  }

  const handleDismiss = () => {
    markOnboardingChecklistDismissed(userId)
    setDismissed(true)
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
        <div className="space-y-1.5">
          <CardTitle className="text-base font-semibold">{t('onboarding.title')}</CardTitle>
          <CardDescription className="text-slate-500">{t('onboarding.description')}</CardDescription>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleDismiss}
          aria-label={t('onboarding.dismissAria')}
          title={t('onboarding.dismissTitle')}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </CardHeader>
      <CardContent>
        <ol className="list-decimal space-y-3 pl-5">
          {ONBOARDING_CHECKLIST_STEPS.map((step) => (
            <li key={step.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div>
                <p className="text-sm font-medium">{t(`onboarding.steps.${step.id}.title`)}</p>
                <p className="text-xs text-slate-500">{t(`onboarding.steps.${step.id}.description`)}</p>
              </div>
              <Button asChild variant="outline" size="sm" className="self-start sm:self-auto">
                <Link to={step.to}>{t(`onboarding.steps.${step.id}.action`)}</Link>
              </Button>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}
