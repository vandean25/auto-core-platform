import { useTranslation } from 'react-i18next'
import { resolveLandingDemoAccessUrl } from '@/auth/landing-demo-email-link'
import { translateLandingDemoFailureReason } from '@/lib/i18n/landing-demo-failure-message'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type LandingDemoSessionRejectedCardProps = {
  onSignOut: () => void
}

export function LandingDemoSessionRejectedCard({ onSignOut }: LandingDemoSessionRejectedCardProps) {
  const { t } = useTranslation('common')
  const landingUrl = resolveLandingDemoAccessUrl()

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{t('landingDemo.sessionRejected.title')}</CardTitle>
        <CardDescription>{t('landingDemo.sessionRejected.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>{translateLandingDemoFailureReason(t, 'grantInvalid')}</AlertDescription>
        </Alert>
        {landingUrl ? (
          <Button asChild className="w-full" variant="outline">
            <a href={landingUrl} rel="noreferrer">
              {t('landingDemo.sessionRejected.requestNewLink')}
            </a>
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">{t('landingDemo.sessionRejected.requestOnLanding')}</p>
        )}
        <Button className="w-full" onClick={onSignOut} type="button" variant="secondary">
          {t('landingDemo.sessionRejected.signOut')}
        </Button>
      </CardContent>
    </Card>
  )
}
