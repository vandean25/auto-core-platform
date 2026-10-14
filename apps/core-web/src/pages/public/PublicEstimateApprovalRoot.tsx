import { PublicEstimateApprovalPage } from './PublicEstimateApprovalPage'

export const PUBLIC_APPROVAL_PATH_PREFIX = '/approve/'

/** The token is the path segment after /approve/. Anything after it (slashes, query) is ignored. */
export function readApprovalToken(pathname: string): string {
  const raw = pathname.slice(PUBLIC_APPROVAL_PATH_PREFIX.length).split('/')[0] ?? ''
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * Entry for /approve/:token. main.tsx renders this instead of the app root, so none of AuthProvider, the router,
 * the app shell or the auth bootstrap run for a customer who only holds the link.
 */
export function PublicEstimateApprovalRoot() {
  return <PublicEstimateApprovalPage token={readApprovalToken(window.location.pathname)} />
}

export default PublicEstimateApprovalRoot
