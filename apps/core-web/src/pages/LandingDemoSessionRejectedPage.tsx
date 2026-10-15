import { demoGrantSessionRejectedMessageDe, resolveLandingDemoAccessUrl } from '@/auth/landing-demo-email-link'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type LandingDemoSessionRejectedPageProps = {
  onSignOut: () => void
}

export default function LandingDemoSessionRejectedPage({
  onSignOut,
}: LandingDemoSessionRejectedPageProps) {
  const landingUrl = resolveLandingDemoAccessUrl()

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50/30 px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Demo-Zugang nicht verfügbar</CardTitle>
          <CardDescription>
            Der serverseitige Demo-Zugang konnte nicht bestätigt werden.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="destructive">
            <AlertDescription>{demoGrantSessionRejectedMessageDe()}</AlertDescription>
          </Alert>
          {landingUrl ? (
            <Button asChild className="w-full" variant="outline">
              <a href={landingUrl} rel="noreferrer">
                Neuen Demo-Link anfordern
              </a>
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              Fordern Sie auf der Auto-Core-Landingpage einen neuen Demo-Link an.
            </p>
          )}
          <Button className="w-full" onClick={onSignOut} type="button" variant="secondary">
            Abmelden
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
