import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import * as customersApi from '@/api/customers'
import { registerGermanUiForTests } from '@/test/german-ui'
import { useCustomerDeleteHandler } from './use-customer-delete-handler'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/api/customers')

registerGermanUiForTests()

function mockDelete(mutateAsync: (id: string) => Promise<unknown>) {
  vi.mocked(customersApi.useDeleteCustomer).mockReturnValue({ mutateAsync } as unknown as ReturnType<
    typeof customersApi.useDeleteCustomer
  >)
}

describe('useCustomerDeleteHandler', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('explains a 409 caused by vehicle parties with the translated stable code', async () => {
    mockDelete(() =>
      Promise.reject(
        Object.assign(new Error('Customer cannot be deleted while vehicle parties reference it.'), {
          data: {
            code: 'CUSTOMER_HAS_VEHICLE_PARTIES',
            message: 'Customer cannot be deleted while vehicle parties reference it.',
          },
        }),
      ),
    )
    const { result } = renderHook(() => useCustomerDeleteHandler())

    await act(() => result.current('cust-1'))

    expect(toast.error).toHaveBeenCalledWith(
      'Dieser Kunde ist noch einem Fahrzeug zugeordnet. Beenden Sie zuerst die Zuordnung.',
    )
  })

  it('shows the generic delete failure when the error carries no stable code', async () => {
    mockDelete(() => Promise.reject(new Error('Network down')))
    const { result } = renderHook(() => useCustomerDeleteHandler())

    await act(() => result.current('cust-1'))

    expect(toast.error).toHaveBeenCalledWith(expect.any(String))
    expect(toast.error).not.toHaveBeenCalledWith('Network down')
  })
})
