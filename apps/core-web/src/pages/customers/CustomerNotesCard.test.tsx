import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/lib/i18n'
import { registerGermanUiForTests } from '@/test/german-ui'
import { canReadCustomerNotes } from '@/features/actions/action-role-predicates'
import enCustomers from '../../../../../locales/en/customers.json'
import { CustomerNotesCard } from './CustomerNotesCard'

const mocks = vi.hoisted(() => ({
  role: 'SALES',
  notesData: [
    {
      id: 'note-unpinned',
      customer_id: 'cust-1',
      body: 'Unpinned older note',
      pinned: false,
      author_member_id: 'mem-1',
      author_role: 'SALES',
      retention_class: 'OPERATIONAL' as const,
      retain_until: '2029-11-25T10:00:00.000Z',
      legal_hold: false,
      created_at: '2026-11-25T11:00:00.000Z',
      updated_at: '2026-11-25T11:00:00.000Z',
    },
    {
      id: 'note-pinned',
      customer_id: 'cust-1',
      body: 'Pinned priority note',
      pinned: true,
      author_member_id: 'mem-1',
      author_role: 'ADMIN',
      retention_class: 'OPERATIONAL' as const,
      retain_until: '2029-11-25T10:00:00.000Z',
      legal_hold: false,
      created_at: '2026-11-24T10:00:00.000Z',
      updated_at: '2026-11-24T10:00:00.000Z',
    },
  ],
  pinMutateAsync: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/features/actions/use-auth-role', () => ({
  useAuthRole: () => mocks.role,
}))

vi.mock('@/api/customers', () => ({
  useCustomerNotes: () => ({
    data: { data: mocks.notesData },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useCreateCustomerNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateCustomerNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePinCustomerNote: () => ({ mutateAsync: mocks.pinMutateAsync, isPending: false }),
  useDeleteCustomerNote: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CustomerNotesCard customerId='cust-1' />
    </QueryClientProvider>,
  )
}

describe('CustomerNotesCard', () => {
  afterEach(async () => {
    cleanup()
    vi.clearAllMocks()
    await i18n.changeLanguage('de')
  })

  it('renders pinned notes on top and triggers pin toggle', () => {
    renderCard()
    const list = screen.getByTestId('customer-notes-list')
    const items = list.querySelectorAll('li')
    expect(items[0]).toHaveAttribute('data-testid', 'customer-note-item-note-pinned')
    expect(items[0]).toHaveAttribute('data-pinned', 'true')
    expect(items[1]).toHaveAttribute('data-testid', 'customer-note-item-note-unpinned')

    const pinButton = screen.getByRole('button', { name: i18n.t('customers:notes.pinAction') })
    fireEvent.click(pinButton)
    expect(mocks.pinMutateAsync).toHaveBeenCalledWith({
      noteId: 'note-unpinned',
      pinned: true,
    })
  })

  it('shows the permanent Art 9 / derogatory-remarks hint in DE and EN', async () => {
    registerGermanUiForTests()
    renderCard()
    const hint = screen.getByTestId('customer-note-legal-hint')
    expect(hint.textContent).toContain('Art. 9 DSGVO')

    i18n.addResourceBundle('en', 'customers', enCustomers, true, true)
    await i18n.changeLanguage('en')
    expect(screen.getByTestId('customer-note-legal-hint').textContent).toContain('Art. 9 GDPR')
  })

  it('hides customer notes for ACCOUNTING, TECH, and DEMO roles', () => {
    expect(canReadCustomerNotes('ACCOUNTING')).toBe(false)
    expect(canReadCustomerNotes('TECH')).toBe(false)
    expect(canReadCustomerNotes('DEMO')).toBe(false)
    expect(canReadCustomerNotes('SALES')).toBe(true)
    expect(canReadCustomerNotes('ADMIN')).toBe(true)
    expect(canReadCustomerNotes('OWNER')).toBe(true)
  })
})
