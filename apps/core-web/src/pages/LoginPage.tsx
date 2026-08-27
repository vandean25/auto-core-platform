import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/auth/AuthProvider'

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
  const { signIn, signInWithGoogle, isConfigured } = useAuth()
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [googleSubmitting, setGoogleSubmitting] = React.useState(false)
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

  return (
    <div className="min-h-screen bg-slate-50/30 flex items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Use your Firebase Authentication account to access Auto Core.</CardDescription>
        </CardHeader>
        <CardContent>
          {!isConfigured ? (
            <div className="text-sm text-destructive space-y-1">
              <p>Firebase Authentication is not configured.</p>
              <p>Set these frontend env vars:</p>
              <p><code>VITE_FIREBASE_API_KEY</code></p>
              <p><code>VITE_FIREBASE_AUTH_DOMAIN</code></p>
              <p><code>VITE_FIREBASE_PROJECT_ID</code></p>
              <p><code>VITE_FIREBASE_APP_ID</code></p>
            </div>
          ) : (
            <form className="space-y-4" noValidate onSubmit={handleSubmit}>
              <Button
                className="w-full"
                disabled={googleSubmitting || submitting}
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
              </div>

              {error ? (
                <Alert id="login-error" variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              <Button className="w-full" disabled={submitting || googleSubmitting} type="submit">
                {submitting ? 'Signing in...' : 'Sign in'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
