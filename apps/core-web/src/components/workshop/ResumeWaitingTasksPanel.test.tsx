import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResumeWaitingTasksPanel } from './ResumeWaitingTasksPanel'

const mutateAsync = vi.fn()

vi.mock('@/api/workshop-waiting-tasks', () => ({
  useResumeWaitingTasks: () => ({ mutateAsync, isPending: false }),
}))

function renderPanel(props: { waitingCount: number; orderStatus: string }) {
  const client = new QueryClient()
  return render(
    <QueryClientProvider client={client}>
      <ResumeWaitingTasksPanel orderId="order-1" {...props} />
    </QueryClientProvider>,
  )
}

describe('ResumeWaitingTasksPanel', () => {
  beforeEach(() => {
    mutateAsync.mockReset()
  })

  it('stays hidden when no task waits for the customer', () => {
    renderPanel({ waitingCount: 0, orderStatus: 'IN_PROGRESS' })
    expect(screen.queryByTestId('resume-waiting-tasks-panel')).toBeNull()
  })

  it('stays hidden for a closed order, which the backend would refuse anyway', () => {
    renderPanel({ waitingCount: 2, orderStatus: 'INVOICED' })
    expect(screen.queryByTestId('resume-waiting-tasks-panel')).toBeNull()
  })

  it('resumes the waiting tasks of an open order on request', async () => {
    mutateAsync.mockResolvedValue({ resumed_task_ids: ['t1', 't2'] })
    renderPanel({ waitingCount: 2, orderStatus: 'IN_PROGRESS' })

    expect(screen.getByText(/2 Aufgaben warten auf den Kunden/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Wartende Aufgaben fortsetzen' }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith('order-1'))
  })
})
