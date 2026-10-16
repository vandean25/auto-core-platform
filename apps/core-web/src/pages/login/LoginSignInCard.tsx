import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/auth/AuthProvider'
import { describeAuthError, getLoginValidationErrorKey } from './login-page-support'

export function LoginSignInCard() {
  const { t } = useTranslation('common')
  const { signIn, signInWithGoogle, sendPasswordResetEmail, isConfigured } = useAuth()
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [googleSubmitting, setGoogleSubmitting] = React.useState(false)
  const [resetSubmitting, setResetSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const handleFieldChange = (setValue: (value: string) => void) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setValue(event.target.value)
    if (error) {
      setError(null)
    }
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const validationErrorKey = getLoginValidationErrorKey(email, password)
    if (validationErrorKey) {
      setError(t(validationErrorKey))
      return
    }

    setError(null)
    setSubmitting(true)

    try {
      await signIn(email.trim(), password)
    } catch (signInError) {
      setError(describeAuthError(signInError, t('login.errors.loginFailed')))
    } finally {
      setSubmitting(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setError(null)
    setGoogleSubmitting(true)

    try {
      await signInWithGoogle()
    } catch (signInError) {
      setError(describeAuthError(signInError, t('login.errors.googleFailed')))
    } finally {
      setGoogleSubmitting(false)
    }
  }

  const handlePasswordReset = async () => {
    const normalizedEmail = email.trim()
    if (!normalizedEmail) {
      toast.error(t('login.toast.resetEmailRequired'))
      return
    }

    setResetSubmitting(true)

    try {
      await sendPasswordResetEmail(normalizedEmail)
      toast.success(t('login.toast.resetSent'))
    } catch {
      toast.error(t('login.toast.resetFailed'))
    } finally {
      setResetSubmitting(false)
    }
  }

  return (
    <Card className="w-full max-w-md justify-self-center">
      <CardHeader>
        <CardTitle>{t('login.signInTitle')}</CardTitle>
        <CardDescription>{t('login.signInDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        {!isConfigured ? (
          <p className="text-sm text-destructive">{t('login.notConfigured')}</p>
        ) : (
          <form className="space-y-4" noValidate onSubmit={handleSubmit}>
            <Button
              className="w-full"
              disabled={googleSubmitting || resetSubmitting || submitting}
              onClick={() => void handleGoogleSignIn()}
              type="button"
              variant="outline"
            >
              {googleSubmitting ? t('login.signingInGoogle') : t('login.continueGoogle')}
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">{t('login.orDivider')}</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">{t('login.email')}</Label>
              <Input
                aria-describedby={error ? 'login-error' : undefined}
                aria-invalid={Boolean(error && !email.trim())}
                autoComplete="email"
                id="email"
                type="email"
                value={email}
                onChange={handleFieldChange(setEmail)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{t('login.password')}</Label>
              <Input
                aria-describedby={error ? 'login-error' : undefined}
                aria-invalid={Boolean(error && !password)}
                autoComplete="current-password"
                id="password"
                type="password"
                value={password}
                onChange={handleFieldChange(setPassword)}
              />
              <Button
                className="h-auto px-0 text-slate-600"
                disabled={googleSubmitting || resetSubmitting || submitting}
                onClick={() => void handlePasswordReset()}
                type="button"
                variant="link"
              >
                {t('login.forgotPassword')}
              </Button>
            </div>

            {error ? (
              <Alert id="login-error" variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <Button className="w-full" disabled={resetSubmitting || submitting || googleSubmitting} type="submit">
              {submitting ? t('login.signingIn') : t('login.signIn')}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
