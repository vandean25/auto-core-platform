import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { WorkshopOrder, WorkshopTask } from '@/api/types'
import { useWorkshopPickerlPrompt } from './useWorkshopPickerlPrompt'

const fetchWithAuth = vi.hoisted(() => vi.fn())
vi.mock('@/api/client', () => ({ fetchWithAuth }))
vi.mock('@/api/auth-session', async (original) => ({
  ...await original<typeof import('@/api/auth-session')>(),
  useAuthSession: () => ({ data: { activeRole: 'ADMIN', effectiveCapabilities: null } }),
}))

describe('useWorkshopPickerlPrompt', () => {
  it('sends no inspection request and offers no prompt while capabilities are unavailable', () => {
    const order = { vehicle: { id: 'v1' } } as WorkshopOrder
    const tasks = [{ id: 't1', title: '§57a Begutachtung', status: 'DONE' }] as WorkshopTask[]
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useWorkshopPickerlPrompt(order, tasks), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    })
    expect(result.current.canManagePickerl).toBe(false)
    expect(result.current.dialogProps.open).toBe(false)
    expect(fetchWithAuth).not.toHaveBeenCalled()
  })
})
