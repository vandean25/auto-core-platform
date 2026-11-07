import type { ReactNode } from 'react'
import type { InfiniteData } from '@tanstack/react-query'
import { QueryClient, QueryClientProvider, useInfiniteQuery } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchWithAuth } from '@/api/client'
import { customerKeys, useUpdateCustomer } from '@/api/customers'
import { usePatchVehicleStock, vehicleStockKeys } from '@/api/vehicle-stock'
import { useUpdateVehicle, vehicleKeys } from '@/api/vehicles'
import { getErrorMessage } from '@/lib/error-utils'
import { infiniteListQueryMeta } from '@/lib/infinite-list-query'
import { registerGermanUiForTests } from '@/test/german-ui'
import errorsDe from '../../../../locales/de/errors.json' with { type: 'json' }

registerGermanUiForTests()

vi.mock('@/api/client', () => ({ API_BASE_URL: 'http://127.0.0.1:3000', fetchWithAuth: vi.fn() }))

type Request = { url: string; method: string; body: unknown; respond: (status: number, body?: unknown) => void }

let requests: Request[]
let answered: Set<Request>

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

function nextRequest(url: string, method = 'PATCH'): Request {
  const request = requests.filter((r) => r.url === url && r.method === method && !answered.has(r)).at(-1)
  if (!request) throw new Error(`no pending ${method} ${url}`)
  answered.add(request)
  return request
}

async function respond(url: string, status: number, body: unknown = {}, method = 'PATCH') {
  nextRequest(url, method).respond(status, body)
  await settle()
}

const sentRequests = (url: string, method = 'PATCH') => requests.filter((r) => r.url === url && r.method === method)

beforeEach(() => {
  requests = []
  answered = new Set()
  vi.mocked(fetchWithAuth).mockImplementation(
    (input, init) =>
      new Promise<Response>((resolve) => {
        requests.push({
          url: String(input),
          method: init?.method ?? 'GET',
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
          respond: (status, body = {}) => resolve({ ok: status < 400, status, json: async () => body } as Response),
        })
      }),
  )
})

afterEach(() => {
  vi.clearAllMocks()
})

type Row = Record<string, unknown>
const OFFSET_PARAMS = { page: 1, pageSize: 10, filters: [] }

/** One editable record with its detail cache and the list cache(s) that show it. */
type EditCase = {
  name: string
  field: string
  before: unknown
  after: unknown
  url: string
  detailKey: readonly unknown[]
  listKey: readonly unknown[]
  /** Builds the list cache around the two rows. */
  list: (rows: Row[]) => unknown
  readRows: (cache: unknown) => Row[]
  edit: (client: QueryClient) => { run: (value: unknown) => Promise<unknown> }
}

const offsetList = (rows: Row[]) => ({ data: rows, meta: { total: rows.length, page: 1, pageSize: 10, pageCount: 1 } })
const offsetRows = (cache: unknown) => (cache as { data: Row[] }).data

function withClient(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const editCases: EditCase[] = [
  {
    name: 'customer phone',
    field: 'phone',
    before: '+43 1 111',
    after: '+43 1 222',
    url: '/api/customers/rec-1',
    detailKey: customerKeys.detail('rec-1'),
    listKey: customerKeys.list(OFFSET_PARAMS),
    list: offsetList,
    readRows: offsetRows,
    edit: (client) => {
      const { result } = renderHook(() => useUpdateCustomer(), { wrapper: withClient(client) })
      return { run: (value) => result.current.mutateAsync({ id: 'rec-1', data: { phone: String(value) } }) }
    },
  },
  {
    name: 'vehicle plate',
    field: 'plate',
    before: 'W-111',
    after: 'W-222',
    url: '/api/vehicles/rec-1',
    detailKey: vehicleKeys.detail('rec-1'),
    listKey: vehicleKeys.list(OFFSET_PARAMS),
    list: offsetList,
    readRows: offsetRows,
    edit: (client) => {
      const { result } = renderHook(() => useUpdateVehicle(), { wrapper: withClient(client) })
      return { run: (value) => result.current.mutateAsync({ id: 'rec-1', data: { plate: String(value) } }) }
    },
  },
  {
    name: 'stock vehicle color (offset list)',
    field: 'color',
    before: 'black',
    after: 'red',
    url: '/api/vehicle-stock/rec-1',
    detailKey: vehicleStockKeys.detail('rec-1'),
    listKey: vehicleStockKeys.list(OFFSET_PARAMS),
    list: offsetList,
    readRows: offsetRows,
    edit: (client) => {
      const { result } = renderHook(() => usePatchVehicleStock('rec-1'), { wrapper: withClient(client) })
      return { run: (value) => result.current.mutateAsync({ color: String(value) }) }
    },
  },
]

function seed(edit: EditCase) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const edited = { id: 'rec-1', [edit.field]: edit.before, untouched: 'keep' }
  const other = { id: 'rec-2', [edit.field]: 'other', untouched: 'other' }
  client.setQueryData(edit.detailKey, edited)
  client.setQueryData(edit.listKey, edit.list([edited, other]))
  return client
}

const editedRow = (edit: EditCase, client: QueryClient) => edit.readRows(client.getQueryData(edit.listKey))[0]!
const otherRow = (edit: EditCase, client: QueryClient) => edit.readRows(client.getQueryData(edit.listKey))[1]!
const detail = (edit: EditCase, client: QueryClient) => client.getQueryData<Row>(edit.detailKey)!

describe.each(editCases)('optimistic $name edit (ADR-0036 R1)', (edit) => {
  // Scenario 1: list and detail change before the PATCH is answered.
  it('shows the new value in the list and the detail before the server responds', async () => {
    const client = seed(edit)
    const { run } = edit.edit(client)

    act(() => void run(edit.after).catch(() => undefined))
    await settle()

    expect(sentRequests(edit.url)).toHaveLength(1)
    expect(detail(edit, client)[edit.field]).toBe(edit.after)
    expect(editedRow(edit, client)[edit.field]).toBe(edit.after)
    expect(otherRow(edit, client)[edit.field]).toBe('other')
  })

  // Scenario 2: a definite rejection restores exactly the edited field, nothing else.
  it('restores the previous value in the list and the detail when the server rejects the edit', async () => {
    const client = seed(edit)
    const { run } = edit.edit(client)
    let rejection: unknown

    act(() => void run(edit.after).catch((error) => (rejection = error)))
    await settle()
    // Another field of the same record changes while the request is in flight; the rollback must keep it.
    client.setQueryData(edit.detailKey, { ...detail(edit, client), untouched: 'changed meanwhile' })
    await respond(edit.url, 422, { message: 'rejected' })

    expect(rejection).toBeInstanceOf(Error)
    expect(detail(edit, client)[edit.field]).toBe(edit.before)
    expect(detail(edit, client).untouched).toBe('changed meanwhile')
    expect(editedRow(edit, client)[edit.field]).toBe(edit.before)
    expect(otherRow(edit, client)).toEqual({ id: 'rec-2', [edit.field]: 'other', untouched: 'other' })
  })

  // Scenario 3: 403 rolls back and the error maps to the permission message the toast uses.
  it('rolls back on 403 and maps the error to the permission message', async () => {
    const client = seed(edit)
    const { run } = edit.edit(client)
    let rejection: unknown

    act(() => void run(edit.after).catch((error) => (rejection = error)))
    await settle()
    await respond(edit.url, 403, { message: 'Forbidden resource' })

    expect(detail(edit, client)[edit.field]).toBe(edit.before)
    expect(editedRow(edit, client)[edit.field]).toBe(edit.before)
    expect(getErrorMessage(rejection, 'fallback')).toBe(errorsDe.codes.HTTP_403)
  })

  // Regression: two quick edits of one record end on the last value, and a rejected older edit does not undo the newer.
  it('keeps the newer edit when an older edit of the same record is rejected', async () => {
    const client = seed(edit)
    const { run } = edit.edit(client)

    act(() => {
      void run('first').catch(() => undefined)
      void run('second').catch(() => undefined)
    })
    await settle()
    expect(detail(edit, client)[edit.field]).toBe('second')
    await respond(edit.url, 422, { message: 'rejected' })
    await settle()

    expect(detail(edit, client)[edit.field]).toBe('second')
    expect(editedRow(edit, client)[edit.field]).toBe('second')
  })
})

describe('server-confirmed edits never patch the cache', () => {
  it('waits for the server on a customer e-mail change (consent flag reset)', async () => {
    const client = seed(editCases[0]!)
    client.setQueryData(customerKeys.detail('rec-1'), { id: 'rec-1', email: 'old@example.test', contact_email_ok: true })
    const { result } = renderHook(() => useUpdateCustomer(), { wrapper: withClient(client) })

    act(() => void result.current.mutateAsync({ id: 'rec-1', data: { email: 'new@example.test' } }).catch(() => undefined))
    await settle()

    expect(sentRequests('/api/customers/rec-1')).toHaveLength(1)
    expect(client.getQueryData<Row>(customerKeys.detail('rec-1'))).toEqual({
      id: 'rec-1',
      email: 'old@example.test',
      contact_email_ok: true,
    })
  })

  it.each([
    { name: 'reservation', patch: { reserved_for_customer_id: 'cust-9' } },
    { name: 'location', patch: { location_id: 'loc-1' } },
    { name: 'NoVA class (tax input)', patch: { nova_class: 'A' } },
    { name: 'a descriptive field together with the reservation', patch: { color: 'red', reserved_for_customer_id: 'cust-9' } },
  ])('waits for the server on a stock vehicle $name', async ({ patch }) => {
    const edit = editCases[2]!
    const client = seed(edit)
    const { result } = renderHook(() => usePatchVehicleStock('rec-1'), { wrapper: withClient(client) })

    act(() => void result.current.mutateAsync(patch).catch(() => undefined))
    await settle()

    expect(sentRequests(edit.url)).toHaveLength(1)
    expect(detail(edit, client)).toEqual({ id: 'rec-1', color: 'black', untouched: 'keep' })
    expect(editedRow(edit, client)).toEqual({ id: 'rec-1', color: 'black', untouched: 'keep' })
  })

  it('waits for the server when a vehicle changes its customer (party records move with it)', async () => {
    const edit = editCases[1]!
    const client = seed(edit)
    const { result } = renderHook(() => useUpdateVehicle(), { wrapper: withClient(client) })

    act(() => void result.current.mutateAsync({ id: 'rec-1', data: { customer_id: 'cust-9' } }).catch(() => undefined))
    await settle()

    expect(detail(edit, client)).toEqual({ id: 'rec-1', plate: 'W-111', untouched: 'keep' })
  })
})

describe('stock vehicle field edit on an infinite list (ADR-0036 R7)', () => {
  const key = vehicleStockKeys.cursorList({ stock_status: 'IN_STOCK' })
  const countKey = vehicleStockKeys.cappedCount({ stock_status: 'IN_STOCK' })

  function seedInfinite() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const pages: InfiniteData<{ data: Row[]; meta: { nextCursor: string | null; hasNextPage: boolean } }> = {
      pages: [
        { data: [{ id: 'rec-1', color: 'black' }, { id: 'rec-2', color: 'blue' }], meta: { nextCursor: 'c2', hasNextPage: true } },
        { data: [{ id: 'rec-3', color: 'grey' }], meta: { nextCursor: null, hasNextPage: false } },
      ],
      pageParams: [undefined, 'c2'],
    }
    const fetchPage = vi.fn()
    // Mounting the real query marks the cache entry as an infinite list the way the stock list does.
    renderHook(
      () =>
        useInfiniteQuery({
          queryKey: key,
          queryFn: fetchPage,
          initialPageParam: undefined as string | undefined,
          getNextPageParam: () => undefined,
          meta: infiniteListQueryMeta(countKey),
          enabled: false,
          initialData: pages,
        }),
      { wrapper: withClient(client) },
    )
    return { client, fetchPage }
  }

  it('patches the loaded row and keeps every retained page without refetching them', async () => {
    const { client, fetchPage } = seedInfinite()
    const { result } = renderHook(() => usePatchVehicleStock('rec-1'), { wrapper: withClient(client) })

    act(() => void result.current.mutateAsync({ color: 'red' }).catch(() => undefined))
    await settle()
    const during = client.getQueryData<{ pages: Array<{ data: Row[] }> }>(key)!
    expect(during.pages[0]!.data[0]).toEqual({ id: 'rec-1', color: 'red' })
    await respond('/api/vehicle-stock/rec-1', 200, { id: 'rec-1', color: 'red' })
    await settle()

    const after = client.getQueryData<{ pages: Array<{ data: Row[] }> }>(key)!
    expect(after.pages.map((page) => page.data.map((row) => row.id))).toEqual([['rec-1', 'rec-2'], ['rec-3']])
    expect(after.pages[0]!.data[0]!.color).toBe('red')
    expect(fetchPage).not.toHaveBeenCalled()
  })

  it('restores the edited field on a rejection without touching the other pages', async () => {
    const { client } = seedInfinite()
    const { result } = renderHook(() => usePatchVehicleStock('rec-1'), { wrapper: withClient(client) })

    act(() => void result.current.mutateAsync({ color: 'red' }).catch(() => undefined))
    await settle()
    await respond('/api/vehicle-stock/rec-1', 403, { message: 'Forbidden resource' })

    const after = client.getQueryData<{ pages: Array<{ data: Row[] }> }>(key)!
    expect(after.pages[0]!.data[0]).toEqual({ id: 'rec-1', color: 'black' })
    expect(after.pages[1]!.data[0]).toEqual({ id: 'rec-3', color: 'grey' })
  })
})
