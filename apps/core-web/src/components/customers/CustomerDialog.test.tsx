import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { CustomerDialog } from './CustomerDialog'
import * as customersApi from '@/api/customers'
import { deCustomers } from '@/test/de-customers'

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

    fireEvent.change(screen.getByLabelText(deCustomers.dialog.firstName), { target: { value: 'Ada' } })
    fireEvent.change(screen.getByLabelText(deCustomers.dialog.lastName), { target: { value: 'Lovelace' } })
    fireEvent.click(screen.getByRole('button', { name: deCustomers.dialog.createCustomer }))

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        deCustomers.dialog.created,
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

describe('CustomerDialog email contact confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  const CHECKBOX_LABEL = deCustomers.dialog.contactEmailOkLabel

  it('sends contact_email_ok with a new customer and explains why it matters', async () => {
    const createCustomer = vi.fn().mockResolvedValue({ id: 'cust-9' })
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

    expect(
      screen.getByText(deCustomers.dialog.contactEmailOkDescriptionEstimate),
    ).toBeTruthy()
    const checkbox = screen.getByRole('checkbox', { name: CHECKBOX_LABEL })
    expect(checkbox.getAttribute('aria-checked')).toBe('false')

    fireEvent.change(screen.getByLabelText(deCustomers.dialog.firstName), { target: { value: 'Ada' } })
    fireEvent.change(screen.getByLabelText(deCustomers.dialog.lastName), { target: { value: 'Lovelace' } })
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: deCustomers.dialog.createCustomer }))

    await waitFor(() => expect(createCustomer).toHaveBeenCalled())
    expect(createCustomer.mock.calls[0][0]).toMatchObject({ contact_email_ok: true })
  })

  it('shows the stored value on edit and sends the changed value with the update', async () => {
    const updateCustomer = vi.fn().mockResolvedValue({ id: 'cust-1' })
    vi.mocked(customersApi.useCreateCustomer).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof customersApi.useCreateCustomer>)
    vi.mocked(customersApi.useUpdateCustomer).mockReturnValue({
      mutateAsync: updateCustomer,
      isPending: false,
    } as unknown as ReturnType<typeof customersApi.useUpdateCustomer>)

    render(
      <MemoryRouter>
        <CustomerDialog
          open={true}
          onOpenChange={vi.fn()}
          customer={
            {
              id: 'cust-1',
              type: 'PRIVATE',
              first_name: 'Ada',
              last_name: 'Lovelace',
              email: 'ada@example.test',
              contact_email_ok: true,
            } as never
          }
        />
      </MemoryRouter>,
    )

    const checkbox = screen.getByRole('checkbox', { name: CHECKBOX_LABEL })
    expect(checkbox.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: deCustomers.dialog.saveChanges }))

    await waitFor(() => expect(updateCustomer).toHaveBeenCalled())
    expect(updateCustomer.mock.calls[0][0]).toMatchObject({ id: 'cust-1', data: { contact_email_ok: false } })
  })

  it('withdraws the confirmation when the address changes, even with the box ticked', async () => {
    const updateCustomer = vi.fn().mockResolvedValue({ id: 'cust-1' })
    vi.mocked(customersApi.useCreateCustomer).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof customersApi.useCreateCustomer>)
    vi.mocked(customersApi.useUpdateCustomer).mockReturnValue({
      mutateAsync: updateCustomer,
      isPending: false,
    } as unknown as ReturnType<typeof customersApi.useUpdateCustomer>)

    render(
      <MemoryRouter>
        <CustomerDialog
          open={true}
          onOpenChange={vi.fn()}
          customer={
            {
              id: 'cust-1',
              type: 'PRIVATE',
              first_name: 'Ada',
              last_name: 'Lovelace',
              email: 'ada@example.test',
              contact_email_ok: true,
            } as never
          }
        />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByDisplayValue('ada@example.test'), {
      target: { value: 'ada@new.example.test' },
    })
    expect(screen.getByRole('checkbox', { name: CHECKBOX_LABEL }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: deCustomers.dialog.saveChanges }))

    await waitFor(() => expect(updateCustomer).toHaveBeenCalled())
    expect(updateCustomer.mock.calls[0][0]).toMatchObject({
      id: 'cust-1',
      data: { email: 'ada@new.example.test', contact_email_ok: false },
    })
  })
})

describe('CustomerDialog on a phone', () => {
  afterEach(() => {
    cleanup()
  })

  it('is full screen with a single-column form and the primary action in the pinned footer', () => {
    vi.mocked(customersApi.useCreateCustomer).mockReturnValue({
      mutateAsync: vi.fn(),
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

    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('max-sm:h-dvh')
    const submit = screen.getByRole('button', { name: deCustomers.dialog.createCustomer })
    expect(submit).toHaveAttribute('type', 'submit')
    expect(submit).toHaveAttribute('form', 'customer-dialog-form')
    expect(dialog.querySelector('.dialog-body')?.contains(submit)).toBe(false)
    expect(dialog.querySelector('.grid')).toHaveClass('grid-cols-1', 'sm:grid-cols-2')
    expect(dialog.querySelectorAll('.grid-cols-2:not(.sm\\:grid-cols-2)')).toHaveLength(0)
  })
})

describe('CustomerDialog optional e-mail and refused fields (AUT-800)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  function mockMutations(options: { create?: ReturnType<typeof vi.fn>; update?: ReturnType<typeof vi.fn> }) {
    vi.mocked(customersApi.useCreateCustomer).mockReturnValue({
      mutateAsync: options.create ?? vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof customersApi.useCreateCustomer>)
    vi.mocked(customersApi.useUpdateCustomer).mockReturnValue({
      mutateAsync: options.update ?? vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof customersApi.useUpdateCustomer>)
  }

  function fillNames() {
    fireEvent.change(screen.getByLabelText(deCustomers.dialog.firstName), { target: { value: 'Ada' } })
    fireEvent.change(screen.getByLabelText(deCustomers.dialog.lastName), { target: { value: 'Lovelace' } })
  }

  it('creates a customer without an e-mail and sends no empty string for it', async () => {
    const createCustomer = vi.fn().mockResolvedValue({ id: 'cust-9' })
    mockMutations({ create: createCustomer })

    render(
      <MemoryRouter>
        <CustomerDialog open={true} onOpenChange={vi.fn()} />
      </MemoryRouter>,
    )
    fillNames()
    fireEvent.change(screen.getByLabelText(deCustomers.dialog.email), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: deCustomers.dialog.createCustomer }))

    await waitFor(() => expect(createCustomer).toHaveBeenCalled())
    expect(createCustomer.mock.calls[0][0].email).toBeUndefined()
  })

  it('clears the e-mail of an existing customer with null when the field is emptied', async () => {
    const updateCustomer = vi.fn().mockResolvedValue({ id: 'cust-1' })
    mockMutations({ update: updateCustomer })

    render(
      <MemoryRouter>
        <CustomerDialog
          open={true}
          onOpenChange={vi.fn()}
          customer={{ id: 'cust-1', type: 'PRIVATE', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.test', contact_email_ok: true } as never}
        />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByLabelText(deCustomers.dialog.email), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: deCustomers.dialog.saveChanges }))

    await waitFor(() => expect(updateCustomer).toHaveBeenCalled())
    expect(updateCustomer.mock.calls[0][0].data).toMatchObject({ email: null, contact_email_ok: false })
  })

  it('marks the e-mail field when the API refuses it, instead of only a generic toast', async () => {
    const refused = Object.assign(new Error('Failed to create customer'), {
      status: 400,
      data: { statusCode: 400, message: ['email must be an email'], code: 'HTTP_400' },
    })
    const createCustomer = vi.fn().mockRejectedValue(refused)
    mockMutations({ create: createCustomer })

    render(
      <MemoryRouter>
        <CustomerDialog open={true} onOpenChange={vi.fn()} />
      </MemoryRouter>,
    )
    fillNames()
    fireEvent.change(screen.getByLabelText(deCustomers.dialog.email), { target: { value: 'ada@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: deCustomers.dialog.createCustomer }))

    expect(await screen.findByText(deCustomers.dialog.errors.email)).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledWith(deCustomers.dialog.checkFields)
    expect(toast.error).not.toHaveBeenCalledWith(deCustomers.dialog.saveFailed)
  })

  it('keeps the generic toast for an error that names no field', async () => {
    mockMutations({ create: vi.fn().mockRejectedValue(new Error('offline')) })

    render(
      <MemoryRouter>
        <CustomerDialog open={true} onOpenChange={vi.fn()} />
      </MemoryRouter>,
    )
    fillNames()
    fireEvent.click(screen.getByRole('button', { name: deCustomers.dialog.createCustomer }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(deCustomers.dialog.saveFailed))
  })
})
