import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import * as customersApi from '@/api/customers'
import { CUSTOMER_FIELD_MAX_LENGTH, type CustomerField } from '@/constants/field-limits'
import { deCustomers } from '@/test/de-customers'
import { CustomerContactCard } from './CustomerContactCard'

vi.mock('@/api/customers')
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))
vi.mock('@/features/tyre-storage/TyreSetsSummary', () => ({
  TyreSetsSummary: () => <div data-testid='tyre-sets' />,
}))

const CUSTOMER = {
  id: 'cust-1',
  type: 'COMPANY',
  legacy_ids: [],
  company_name: 'Acme GmbH',
  first_name: 'Max',
  last_name: 'Muster',
  email: 'max@example.test',
  phone: '+43 660 1234567',
  vat_id: 'ATU12345678',
  address_street: 'Hauptstrasse 1',
  address_zip: '1010',
  address_city: 'Wien',
  address_country: 'AT',
}

/** aria key and capped field of every inline-editable entry on the card. */
const EDITABLE_FIELDS = [
  ['companyName', 'company_name'],
  ['contactFirstName', 'first_name'],
  ['contactLastName', 'last_name'],
  ['email', 'email'],
  ['phone', 'phone'],
  ['street', 'address_street'],
  ['zip', 'address_zip'],
  ['city', 'address_city'],
  ['country', 'address_country'],
  ['vatId', 'vat_id'],
] as const satisfies ReadonlyArray<
  readonly [keyof typeof deCustomers.detail.aria, CustomerField]
>

function mockUpdate(result: { mutateAsync: ReturnType<typeof vi.fn> }) {
  vi.mocked(customersApi.useUpdateCustomer).mockReturnValue({
    mutateAsync: result.mutateAsync,
    isPending: false,
  } as never)
}

describe('CustomerContactCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdate({ mutateAsync: vi.fn().mockResolvedValue({ id: 'cust-1' }) })
  })

  afterEach(() => {
    cleanup()
  })

  it('caps every editable field at the length the API accepts', () => {
    render(<CustomerContactCard customer={CUSTOMER as never} />)

    for (const [ariaKey, field] of EDITABLE_FIELDS) {
      const label = deCustomers.detail.aria[ariaKey]
      fireEvent.click(screen.getByRole('button', { name: CUSTOMER[field] }))
      expect(screen.getByLabelText(label)).toHaveAttribute(
        'maxLength',
        String(CUSTOMER_FIELD_MAX_LENGTH[field]),
      )
      fireEvent.keyDown(screen.getByLabelText(label), { key: 'Escape' })
    }
  })

  it('reports a refused edit in German, not with the API text', async () => {
    mockUpdate({ mutateAsync: vi.fn().mockRejectedValue(new Error('Failed to update customer')) })

    render(<CustomerContactCard customer={CUSTOMER as never} />)
    fireEvent.click(screen.getByRole('button', { name: 'Wien' }))
    const city = screen.getByLabelText(deCustomers.detail.aria.city)
    fireEvent.change(city, { target: { value: 'Bratislava' } })
    fireEvent.keyDown(city, { key: 'Enter' })

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(toast.error).toHaveBeenCalledWith(deCustomers.detail.updateFailed)
    expect(toast.error).not.toHaveBeenCalledWith('Failed to update customer')
  })
})
