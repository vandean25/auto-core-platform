/** The customer approval page lives under this path (ADR-0025 §7). */
export const PUBLIC_APPROVAL_PATH_PREFIX = '/approve/'

/**
 * Whether a path is the approval page. The server's route matches in any letter case, because Express routes paths
 * that way, so the entry points match in any case too. Only the prefix is compared in lower case; the token keeps its
 * case.
 */
export function isPublicApprovalPath(pathname: string): boolean {
  return pathname.toLowerCase().startsWith(PUBLIC_APPROVAL_PATH_PREFIX)
}
