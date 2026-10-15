import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { completeLandingDemoEmailLinkSignIn } from '@/auth/completeLandingDemoEmailLinkSignIn'
import {
  clearFirebaseEmailLinkQueryParams,
  describeLandingDemoEmailLinkError,
  isFirebaseEmailLinkSignInUrl,
  isLandingDemoEmailLinkExpiredError,
  readStoredLandingDemoEmail,
  resolveLandingDemoAccessUrl,
} from '@/auth/landing-demo-email-link'
import { warmLandingDemoAuthSession } from '@/auth/warmLandingDemoAuthSession'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { firebaseConfigMissing } from '@/lib/firebase'

type CompletionPhase = 'completing' | 'needs-email' | 'error'

/** Survives StrictMode remount so Firebase oob codes are not consumed twice. */
const autoCompletionStartedForHref = new Set<string>()

/** @internal test-only */
export function resetLandingDemoAutoCompletionGuardForTests() {
  autoCompletionStartedForHref.clear()
}

function RequestNewDemoLinkAction() {
  const landingUrl = resolveLandingDemoAccessUrl()

  if (!landingUrl) {
    return (
      <p className="text-sm text-muted-foreground">
        Fordern Sie auf der Auto-Core-Landingpage einen neuen Demo-Link an.
      </p>
    )
  }

  return (
    <Button asChild className="w-full" variant="outline">
      <a href={landingUrl} rel="noreferrer">
        Neuen Demo-Link anfordern
      </a>
    </Button>
  )
}

export default function LandingDemoEmailLinkCompletionPage() {
  const navigate = useNavigate()
  const [phase, setPhase] = React.useState<CompletionPhase>('completing')
  const [email, setEmail] = React.useState(() => readStoredLandingDemoEmail() ?? '')
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [showRequestNewLink, setShowRequestNewLink] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)

  const emailLinkUrl = typeof globalThis.location !== 'undefined' ? globalThis.location.href : ''
  const completionInFlightRef = React.useRef(false)

  const runCompletion = React.useCallback(
    async (resolvedEmail: string) => {
      if (completionInFlightRef.current) {
        return
      }

      completionInFlightRef.current = true
      setSubmitting(true)
      setErrorMessage(null)
      setShowRequestNewLink(false)

      try {
        await completeLandingDemoEmailLinkSignIn(resolvedEmail, emailLinkUrl)
        clearFirebaseEmailLinkQueryParams(emailLinkUrl)
        await warmLandingDemoAuthSession()
        navigate(APP_ROUTE_PATHS.inventory, { replace: true })
      } catch (error) {
        autoCompletionStartedForHref.delete(emailLinkUrl)
        setPhase('error')
        setErrorMessage(describeLandingDemoEmailLinkError(error))
        setShowRequestNewLink(isLandingDemoEmailLinkExpiredError(error))
      } finally {
        completionInFlightRef.current = false
        setSubmitting(false)
      }
    },
    [emailLinkUrl, navigate],
  )

  React.useEffect(() => {
    if (firebaseConfigMissing || !isFirebaseEmailLinkSignInUrl(emailLinkUrl)) {
      setPhase('error')
      setErrorMessage('Dieser Anmeldelink ist ungültig oder die Anmeldung ist nicht konfiguriert.')
      setShowRequestNewLink(false)
      return
    }

    const storedEmail = readStoredLandingDemoEmail()
    if (storedEmail) {
      setEmail(storedEmail)
      if (autoCompletionStartedForHref.has(emailLinkUrl)) {
        return
      }

      autoCompletionStartedForHref.add(emailLinkUrl)
      void runCompletion(storedEmail)
      return
    }

    setPhase('needs-email')
  }, [emailLinkUrl, runCompletion])

  const handleEmailSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalized = email.trim()
    if (!normalized) {
      setErrorMessage(
        'Bitte geben Sie die E-Mail-Adresse ein, mit der Sie die Demo angefordert haben.',
      )
      return
    }

    setPhase('completing')
    void runCompletion(normalized)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50/30 px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Demo-Anmeldung</CardTitle>
          <CardDescription>
            Wir schließen Ihre Anmeldung ab und leiten Sie in die Demo-Umgebung weiter.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {phase === 'completing' && !errorMessage ? (
            <p className="text-sm text-muted-foreground" role="status">
              Anmeldung wird abgeschlossen…
            </p>
          ) : null}

          {phase === 'needs-email' ? (
            <form className="space-y-4" noValidate onSubmit={handleEmailSubmit}>
              <div className="space-y-2">
                <Label htmlFor="landing-demo-email">E-Mail</Label>
                <Input
                  autoComplete="email"
                  id="landing-demo-email"
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value)
                    if (errorMessage) {
                      setErrorMessage(null)
                    }
                  }}
                />
              </div>
              {errorMessage ? (
                <Alert variant="destructive">
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
              ) : null}
              <Button className="w-full" disabled={submitting} type="submit">
                {submitting ? 'Anmeldung läuft…' : 'Demo starten'}
              </Button>
            </form>
          ) : null}

          {phase === 'error' || (phase === 'completing' && errorMessage) ? (
            <div className="space-y-4">
              <Alert variant="destructive">
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
              {showRequestNewLink ? <RequestNewDemoLinkAction /> : null}
              {!showRequestNewLink && phase === 'error' ? (
                <Button
                  className="w-full"
                  disabled={submitting}
                  onClick={() => {
                    setPhase('needs-email')
                    setErrorMessage(null)
                  }}
                  type="button"
                  variant="outline"
                >
                  Erneut versuchen
                </Button>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
