const STORAGE_KEY_PREFIX = 'acp:onboarding-checklist:dismissed:'

function storageKeyFor(userId: string) {
  return `${STORAGE_KEY_PREFIX}${userId}`
}

export function isOnboardingChecklistDismissed(userId: string): boolean {
  try {
    return window.localStorage.getItem(storageKeyFor(userId)) === 'true'
  } catch {
    return false
  }
}

export function markOnboardingChecklistDismissed(userId: string): void {
  try {
    window.localStorage.setItem(storageKeyFor(userId), 'true')
  } catch {
    // Storage can be blocked (private mode, disabled site data). The card still hides for this visit.
  }
}
