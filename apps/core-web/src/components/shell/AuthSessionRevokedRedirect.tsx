import * as React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { AuthLoadingScreen } from '@/components/shell/AuthLoadingScreen'
import { LOGIN_PATH } from '@/lib/app-route-paths'

type AuthSessionRevokedRedirectProps = {
  signOutUser: () => Promise<void>
}

export function AuthSessionRevokedRedirect({ signOutUser }: AuthSessionRevokedRedirectProps) {
  const location = useLocation()
  const [signedOut, setSignedOut] = React.useState(false)

  React.useEffect(() => {
    void signOutUser()
      .catch(() => undefined)
      .finally(() => {
        setSignedOut(true)
      })
  }, [signOutUser])

  if (!signedOut) {
    return <AuthLoadingScreen />
  }

  return <Navigate to={LOGIN_PATH} replace state={{ from: location }} />
}
