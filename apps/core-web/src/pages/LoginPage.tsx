import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/auth/AuthProvider'

const DEMO_HOSTNAME = 'auto-core-platform-vande.web.app'
const DOCUMENTATION_URL = 'https://autocore-platform.mintlify.site/'

function isDemoHost() {
  return typeof globalThis.location !== 'undefined' && globalThis.location.hostname === DEMO_HOSTNAME
}

function describeAuthError(error: unknown, fallback: string) {
  if (error && typeof error === 'object') {
    const details = [
      ['name', 'name' in error ? String((error as { name?: string }).name ?? '') : ''],
      ['code', 'code' in error ? String((error as { code?: string }).code ?? '') : ''],
      ['message', 'message' in error ? String((error as { message?: string }).message ?? '') : ''],
    ]
      .filter(([, value]) => value)
      .map(([key, value]) => `${key}=${value}`)

    if (details.length > 0) {
      return `${fallback} (${details.join(', ')})`
    }
  }

  return fallback
}

function getValidationError(email: string, password: string) {
  const trimmedEmail = email.trim()

  if (!trimmedEmail && !password) {
    return 'Email and password are required'
  }

  if (!trimmedEmail) {
    return 'Email is required'
  }

  if (!password) {
    return 'Password is required'
  }

  return null
}

export default function LoginPage() {
  const { signIn, signInWithGoogle, sendPasswordResetEmail, isConfigured } = useAuth()
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [googleSubmitting, setGoogleSubmitting] = React.useState(false)
  const [resetSubmitting, setResetSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const validationError = getValidationError(email, password)
    if (validationError) {
      setError(validationError)
      return
    }

    setError(null)
    setSubmitting(true)

    try {
      await signIn(email.trim(), password)
    } catch (signInError) {
      setError(describeAuthError(signInError, 'Login failed. Verify your email and password and try again.'))
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
      setError(describeAuthError(signInError, 'Google login failed. Try again.'))
    } finally {
      setGoogleSubmitting(false)
    }
  }

  const handlePasswordReset = async () => {
    const normalizedEmail = email.trim()
    if (!normalizedEmail) {
      toast.error('Enter your email to reset your password.')
      return
    }

    setResetSubmitting(true)

    try {
      await sendPasswordResetEmail(normalizedEmail)
      toast.success('Check your email for a reset link.')
    } catch {
      toast.error('We could not send a reset email. Check the address and try again.')
    } finally {
      setResetSubmitting(false)
    }
  }

  const demoHost = isDemoHost()

  return (
    <div className="min-h-screen bg-slate-50/30 px-4 py-10 sm:px-6">
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] w-full max-w-5xl items-center gap-10 md:grid-cols-2 md:gap-16">
        <section className="space-y-6 text-slate-900">
          <div className="space-y-3">
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Auto Core</h1>
            <p className="max-w-md text-lg leading-8 text-slate-600">
              ACP keeps stock, jobs, and invoices in one workshop ledger.
            </p>
          </div>

          <ul className="space-y-3 text-sm font-medium text-slate-700">
            <li className="flex items-center gap-3"><span className="h-2 w-2 rounded-full bg-slate-900" />Parts on the shelf</li>
            <li className="flex items-center gap-3"><span className="h-2 w-2 rounded-full bg-slate-900" />Jobs on the board</li>
            <li className="flex items-center gap-3"><span className="h-2 w-2 rounded-full bg-slate-900" />Invoices with a paper trail</li>
          </ul>

          {demoHost ? (
            <div className="max-w-md rounded-xl border border-slate-200 bg-white/80 p-4 text-sm text-slate-600 shadow-sm">
              <p className="font-semibold text-slate-900">Demo workshop</p>
              <p>Office: grok-bot@auto.core.at</p>
              <p>Mechanic: grok-bot-tech@auto.core.at</p>
              <p className="mt-2 text-slate-500">Ask the demo owner for the password.</p>
            </div>
          ) : null}

          <a
            className="inline-flex text-sm font-medium text-slate-600 underline decoration-slate-300 underline-offset-4 hover:text-slate-900"
            href={DOCUMENTATION_URL}
            rel="noreferrer"
            target="_blank"
          >
            Documentation
          </a>
        </section>

        <Card className="w-full max-w-md justify-self-center">
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>Sign in with the email your workshop invited.</CardDescription>
          </CardHeader>
          <CardContent>
            {!isConfigured ? (
              <p className="text-sm text-destructive">Sign-in is not configured for this deployment.</p>
            ) : (
              <form className="space-y-4" noValidate onSubmit={handleSubmit}>
                <Button
                  className="w-full"
                  disabled={googleSubmitting || resetSubmitting || submitting}
                  onClick={() => void handleGoogleSignIn()}
                  type="button"
                  variant="outline"
                >
                  {googleSubmitting ? 'Signing in with Google...' : 'Continue with Google'}
                </Button>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">Or</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    aria-describedby={error ? 'login-error' : undefined}
                    aria-invalid={Boolean(error && !email.trim())}
                    autoComplete="email"
                    id="email"
                    type="email"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value)
                      if (error) {
                        setError(null)
                      }
                    }}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    aria-describedby={error ? 'login-error' : undefined}
                    aria-invalid={Boolean(error && !password)}
                    autoComplete="current-password"
                    id="password"
                    type="password"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value)
                      if (error) {
                        setError(null)
                      }
                    }}
                  />
                  <Button
                    className="h-auto px-0 text-slate-600"
                    disabled={googleSubmitting || resetSubmitting || submitting}
                    onClick={() => void handlePasswordReset()}
                    type="button"
                    variant="link"
                  >
                    Forgot password?
                  </Button>
                </div>

                {error ? (
                  <Alert id="login-error" variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}

                <Button className="w-full" disabled={resetSubmitting || submitting || googleSubmitting} type="submit">
                  {submitting ? 'Signing in...' : 'Sign in'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
