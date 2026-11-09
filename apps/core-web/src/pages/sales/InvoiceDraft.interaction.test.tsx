import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'

import { fetchWithAuth } from '@/api/client'
import errorsDe from '../../../../../locales/de/errors.json'
import { deSales } from '@/test/de-sales'
import { registerGermanUiForTests } from '@/test/german-ui'
import InvoiceDraftEditPage from './InvoiceDraftEditPage'

registerGermanUiForTests()

vi.mock('@/api/client', () => ({ API_BASE_URL: 'http://127.0.0.1:3000', fetchWithAuth: vi.fn() }))
vi.mock('@/lib/firebase', () => ({ firebaseAuth: { currentUser: null }, firebaseConfigMissing: false }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

type Held = { url: string; method: string; body: unknown; respond: (status: number, body?: unknown) => void }

const http = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response

const invoice = {
  id: 'inv-1',
  status: 'DRAFT',
  sales_order_id: 'so-1',
  customer_id: 'cust-1',
  customer: { id: 'cust-1', type: 'PRIVATE', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com' },
  date: '2026-09-21T00:00:00.000Z',
  due_date: '2026-10-05T00:00:00.000Z',
  total_net: '10',
  total_tax: '2',
  total_gross: '12',
  notes: null,
  internal_notes: 'Alt',
  items: [{ id: 'line-1', description: 'Brake pads', quantity: '1', unit_price: '10', tax_rate: '20', line_total: '12' }],
}

let held: Held[] = []
let patches: unknown[] = []
let currentInvoice = invoice

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

function renderDraft() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/sales/invoices/inv-1/edit']}>
        <Routes>
          <Route path="/sales/invoices/:id/edit" element={<InvoiceDraftEditPage />} />
          <Route path="/sales/invoices/:id" element={<p>issued-invoice</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  held = []
  patches = []
  currentInvoice = { ...invoice, items: [{ ...invoice.items[0] }] }
  vi.mocked(fetchWithAuth).mockImplementation((url, init) => {
    const path = String(url)
    const method = init?.method ?? 'GET'
    if (method === 'GET' && path === '/api/sales/invoices/inv-1') return Promise.resolve(http(200, currentInvoice))
    if (method === 'GET' && path === '/api/sales-orders/so-1') {
      return Promise.resolve(http(200, { id: 'so-1', status: 'DRAFT', customer: invoice.customer, items: [] }))
    }
    if (method === 'PATCH' && path === '/api/sales/invoices/inv-1') {
      patches.push(init?.body ? JSON.parse(String(init.body)) : null)
      return new Promise<Response>((resolve) => {
        held.push({
          url: path,
          method,
          body: init?.body ? JSON.parse(String(init.body)) : null,
          respond: (status, body = {}) => resolve(http(status, body) as Response),
        })
      })
    }
    if (method === 'PUT' && path === '/api/sales/invoices/inv-1/finalize') {
      return new Promise<Response>((resolve) => {
        held.push({
          url: path,
          method,
          body: null,
          respond: (status, body = {}) => resolve(http(status, body) as Response),
        })
      })
    }
    return Promise.resolve(http(200, { data: [], meta: { total: 0, page: 1, pageSize: 10, pageCount: 1 } }))
  })
})

async function openNote() {
  renderDraft()
  const note = await screen.findByText('Alt')
  fireEvent.click(note)
  const field = screen.getByRole('textbox', { name: deSales.invoices.draft.internalNotesAria })
  fireEvent.change(field, { target: { value: 'Neu' } })
  fireEvent.keyDown(field, { key: 'Enter' })
  await settle()
}

describe('Invoice draft interaction (AUT-896)', () => {
  it('keeps the finalize label pending until the server issues the invoice', async () => {
    renderDraft()
    const issue = await screen.findByRole('button', { name: deSales.invoices.draft.finalize })
    await waitFor(() => expect(issue).toBeEnabled())
    fireEvent.click(issue)
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: deSales.invoiceEditor.finalizeDialog.confirm }))
    await waitFor(() => expect(held.some((request) => request.method === 'PATCH')).toBe(true))
    held.find((request) => request.method === 'PATCH')?.respond(200, currentInvoice)
    await waitFor(() => expect(held.some((request) => request.method === 'PUT')).toBe(true))

    const confirm = within(screen.getByRole('alertdialog')).getByRole('button', { name: /Rechnung ausstellen/ })
    expect(confirm).toHaveAttribute('aria-busy', 'true')
    expect(confirm).toBeDisabled()
    expect(screen.getByRole('heading', { name: deSales.invoices.draft.title, hidden: true })).toBeInTheDocument()
    expect(screen.queryByText('issued-invoice')).not.toBeInTheDocument()
    expect(held.filter((request) => request.method === 'PUT')).toHaveLength(1)
  })

  it('shows the new note before the server responds and restores it with an error marker', async () => {
    await openNote()
    expect(screen.getByText('Neu')).toBeInTheDocument()

    held.find((request) => request.method === 'PATCH')?.respond(500, { message: 'down' })
    await waitFor(() => expect(screen.getByText('Alt')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent(deSales.invoices.draft.internalNotesFailed)
    expect(patches).toHaveLength(1)
  })

  it('shows the current server note after a 409 and does not replay the write', async () => {
    await openNote()
    currentInvoice = { ...currentInvoice, internal_notes: 'Serverstand' }
    held.find((request) => request.method === 'PATCH')?.respond(409, { message: 'stale' })
    await settle()
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Konflikt: Serverstand'))

    expect(patches).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /erneut/i })).not.toBeInTheDocument()
  })

  it('shows the permission error for a 403 and keeps the previous note', async () => {
    await openNote()
    held.find((request) => request.method === 'PATCH')?.respond(403, { message: 'Geheim' })
    await settle()

    await waitFor(() => expect(screen.getByText('Alt')).toBeInTheDocument())
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(errorsDe.codes.HTTP_403)
    expect(screen.queryByText('Geheim')).not.toBeInTheDocument()
  })
})
