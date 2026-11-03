import { useAuth } from '@/auth/AuthProvider'

export function useAuthRole(): string | undefined {
  const { claims } = useAuth()
  return claims?.role
}
