import { useState } from 'react'
import { Link } from 'react-router-dom'
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
          <CardTitle className="text-base font-semibold">Get your workshop set up</CardTitle>
          <CardDescription className="text-slate-500">
            Four steps to get your first jobs on the board. Dismiss this card once you are set up.
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleDismiss}
          aria-label="Dismiss onboarding checklist"
          title="Dismiss onboarding checklist"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </CardHeader>
      <CardContent>
        <ol className="list-decimal space-y-3 pl-5">
          {ONBOARDING_CHECKLIST_STEPS.map((step) => (
            <li key={step.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div>
                <p className="text-sm font-medium">{step.title}</p>
                <p className="text-xs text-slate-500">{step.description}</p>
              </div>
              <Button asChild variant="outline" size="sm" className="self-start sm:self-auto">
                <Link to={step.to}>{step.actionLabel}</Link>
              </Button>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}
