import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import * as customersApi from '@/api/customers'
import { CUSTOMER_FIELD_MAX_LENGTH, type CustomerField } from '@/constants/field-limits'
import { deCustomers } from '@/test/de-customers'
import deCommon from '../../../../../locales/de/common.json'
import errorsDe from '../../../../../locales/de/errors.json'
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

  describe('optimistic edit rejection (ADR-0036 R1)', () => {
    const MARKER = 'Acme GmbH: Ort nicht gespeichert, vorheriger Wert wiederhergestellt.'

    async function editCity(value: string) {
      fireEvent.click(screen.getByRole('button', { name: 'Wien' }))
      const city = screen.getByLabelText(deCustomers.detail.aria.city)
      fireEvent.change(city, { target: { value } })
      fireEvent.keyDown(city, { key: 'Enter' })
    }

    // Scenario 2: the editor closes at once; a rejection leaves a marker that names the record and the field.
    it('closes the editor at once and keeps a marker with the record and field until dismissed', async () => {
      mockUpdate({ mutateAsync: vi.fn().mockRejectedValue(new Error('Failed to update customer')) })
      render(<CustomerContactCard customer={CUSTOMER as never} />)

      await editCity('Bratislava')

      expect(await screen.findByRole('alert')).toHaveTextContent(MARKER)
      expect(screen.queryByLabelText(deCustomers.detail.aria.city)).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: deCommon.dataTable.loading.dismiss }))
      expect(screen.queryByText(MARKER)).not.toBeInTheDocument()
    })

    // Retry is safe for a PATCH: it sends the same field and value again and clears the marker when it succeeds.
    it('retries the rejected value from the marker', async () => {
      const mutateAsync = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ id: 'cust-1' })
      mockUpdate({ mutateAsync })
      render(<CustomerContactCard customer={CUSTOMER as never} />)

      await editCity('Bratislava')
      fireEvent.click(await screen.findByRole('button', { name: deCommon.dataTable.loading.retry }))

      await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2))
      expect(mutateAsync).toHaveBeenLastCalledWith({ id: 'cust-1', data: { address_city: 'Bratislava' } })
      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    })

    // Scenario 3: HTTP 403 shows the permission error, not the generic fallback.
    it('shows the permission message when the server answers 403', async () => {
      mockUpdate({
        mutateAsync: vi.fn().mockRejectedValue(Object.assign(new Error('Forbidden resource'), { status: 403 })),
      })
      render(<CustomerContactCard customer={CUSTOMER as never} />)

      await editCity('Bratislava')

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(errorsDe.codes.HTTP_403))
      expect(toast.error).not.toHaveBeenCalledWith(deCustomers.detail.updateFailed)
    })

    // The e-mail change resets the consent flag on the server, so it is not optimistic: the editor waits and no marker shows.
    it('keeps the editor open and shows no marker while a server-confirmed e-mail edit is rejected', async () => {
      mockUpdate({ mutateAsync: vi.fn().mockRejectedValue(new Error('Failed to update customer')) })
      render(<CustomerContactCard customer={CUSTOMER as never} />)

      fireEvent.click(screen.getByRole('button', { name: 'max@example.test' }))
      const email = screen.getByLabelText(deCustomers.detail.aria.email)
      fireEvent.change(email, { target: { value: 'new@example.test' } })
      fireEvent.keyDown(email, { key: 'Enter' })

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(deCustomers.detail.updateFailed))
      expect(screen.getByLabelText(deCustomers.detail.aria.email)).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })
})
