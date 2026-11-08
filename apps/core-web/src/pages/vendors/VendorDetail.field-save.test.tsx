import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchWithAuth } from '@/api/client'
import { vendorKeys } from '@/api/vendors'
import deFinance from '../../../../../locales/de/finance.json'
import errorsDe from '../../../../../locales/de/errors.json'
import VendorDetail from './VendorDetail'

vi.mock('@/api/client', () => ({ API_BASE_URL: 'http://127.0.0.1:3000', fetchWithAuth: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const vendor = {
  id: 'vendor-1',
  name: 'Alt',
  email: 'lager@example.test',
  account_number: '70001',
  supportedBrands: [],
  purchase_orders: [],
  purchase_invoices: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

type Gate = { resolve: (status: number) => void }

let putGate: Gate | null

function jsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body } as Response
}

function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  client.setQueryData(vendorKeys.detail('vendor-1'), vendor)
  client.setQueryData(vendorKeys.list(), {
    data: [{ ...vendor }, { ...vendor, id: 'vendor-2', name: 'Andere' }],
    meta: { total: 2, page: 1, pageSize: 10, pageCount: 1 },
  })
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/vendors/vendor-1']}>
        <Routes>
          <Route path="/vendors/:id" element={<VendorDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { client, ...view }
}

async function rename(next: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Alt' }))
  const input = screen.getByLabelText(deFinance.vendors.detail.vendorNameAria)
  fireEvent.change(input, { target: { value: next } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  putGate = null
  vi.mocked(fetchWithAuth).mockImplementation((input, init) => {
    const url = String(input)
    if (init?.method === 'PUT') {
      return new Promise<Response>((resolve) => {
        putGate = { resolve: (status) => resolve(jsonResponse(status, { message: 'no' })) }
      })
    }
    if (url.includes('/articles')) return Promise.resolve(jsonResponse(200, []))
    return Promise.resolve(jsonResponse(200, vendor))
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('vendor name save (ADR-0036 R1)', () => {
  // Scenario 2: a rejected save restores the previous value and shows an error marker.
  it('restores the previous name and shows an error marker when the server rejects the save', async () => {
    const { client } = renderDetail()
    await screen.findByRole('heading', { name: 'Alt' })

    await rename('Neu')
    expect(client.getQueryData<{ name: string }>(vendorKeys.detail('vendor-1'))?.name).toBe('Neu')

    await act(async () => putGate?.resolve(422))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Alt' })).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Alt' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Alt: Name nicht gespeichert')
    expect(client.getQueryData<{ data: Array<{ name: string }> }>(vendorKeys.list())?.data[0]?.name).toBe('Alt')
    expect(client.getQueryData<{ data: Array<{ name: string }> }>(vendorKeys.list())?.data[1]?.name).toBe('Andere')
  })

  // Scenario 3: a 403 rolls the name back and shows the permission error, not the stored record of another vendor.
  it('rolls back on 403 and shows the permission error', async () => {
    const { client } = renderDetail()
    await screen.findByRole('heading', { name: 'Alt' })

    await rename('Geheim')
    await act(async () => putGate?.resolve(403))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(errorsDe.codes.HTTP_403))
    expect(toast.error).not.toHaveBeenCalledWith(deFinance.vendors.detail.toast.updateFailed)
    expect(screen.getByRole('heading', { name: 'Alt' })).toBeInTheDocument()
    expect(screen.queryByText('Geheim')).not.toBeInTheDocument()
    expect(client.getQueryData<{ name: string }>(vendorKeys.detail('vendor-1'))?.name).toBe('Alt')
    expect(client.getQueryData<{ data: Array<{ name: string }> }>(vendorKeys.list())?.data.map((row) => row.name)).toEqual([
      'Alt',
      'Andere',
    ])
  })
})
