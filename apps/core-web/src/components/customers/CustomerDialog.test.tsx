import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { CustomerDialog } from './CustomerDialog'
import * as customersApi from '@/api/customers'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

vi.mock('@/api/customers')
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('CustomerDialog create flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('shows a Customer created toast whose Open action opens the new customer', async () => {
    const createCustomer = vi.fn().mockResolvedValue({ id: 'cust-9', first_name: 'Ada', last_name: 'Lovelace' })
    vi.mocked(customersApi.useCreateCustomer).mockReturnValue({
      mutateAsync: createCustomer,
      isPending: false,
    } as unknown as ReturnType<typeof customersApi.useCreateCustomer>)
    vi.mocked(customersApi.useUpdateCustomer).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof customersApi.useUpdateCustomer>)

    render(
      <MemoryRouter>
        <CustomerDialog open={true} onOpenChange={vi.fn()} />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('First Name'), { target: { value: 'Ada' } })
    fireEvent.change(screen.getByLabelText('Last Name'), { target: { value: 'Lovelace' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Customer' }))

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        'Customer created',
        expect.objectContaining({ action: expect.objectContaining({ label: 'Open' }) }),
      )
    })
    const [, toastOptions] = vi.mocked(toast.success).mock.calls[0] as unknown as [
      string,
      { action: { onClick: () => void } },
    ]
    mockNavigate.mockClear()
    toastOptions.action.onClick()

    expect(mockNavigate).toHaveBeenCalledWith('/customers/cust-9')
  })
})
