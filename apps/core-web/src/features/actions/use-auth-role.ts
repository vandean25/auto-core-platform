import { useAuth } from '@/auth/AuthProvider'

export function useAuthRole(): string | undefined {
  try {
    return useAuth().claims?.role
  } catch {
    return undefined
  }
}
