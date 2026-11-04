import * as React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import type { ImportJobListItem } from '@/api/imports'
import * as importsApi from '@/api/imports'
import { useTenantMembers } from '@/api/tenant-members'
import * as authRole from '@/features/actions/use-auth-role'

import deEnums from '../../../../../../locales/de/enums.json'
import deSettings from '../../../../../../locales/de/settings.json'
import enSettings from '../../../../../../locales/en/settings.json'

import { DataImportHistoryView } from './data-import-history-view'

const di = deSettings.dataImport

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/lib/download', () => ({ triggerBlobDownload: vi.fn() }))
vi.mock('@/api/imports', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/imports')>()
  return {
    ...actual,
    useImportJobs: vi.fn(),
    useCancelImportJob: vi.fn(),
    downloadImportErrorRowsCsv: vi.fn(),
  }
})
vi.mock('@/api/tenant-members', () => ({ useTenantMembers: vi.fn() }))
vi.mock('@/features/actions/use-auth-role', () => ({ useAuthRole: vi.fn() }))

const jobs: ImportJobListItem[] = [
  {
    id: 'job-2',
    status: 'DRY_RUN_DONE',
    entity_type: 'VEHICLE',
    source_system: 'synthetic_erp',
    file_name: 'vehicles.csv',
    totals: { create: 2, update: 0, skip: 1, error: 0 },
    created_by: null,
    created_by_name: null,
    created_at: '2026-01-02T00:00:00.000Z',
    applied_at: null,
    undoable: false,
    cancellable: false,
  },
  {
    id: 'job-1',
    status: 'APPLIED',
    entity_type: 'CUSTOMER',
    source_system: 'synthetic_erp',
    file_name: 'customers.csv',
    totals: { create: 1, update: 0, skip: 0, error: 0 },
    created_by: 'user-1',
    created_by_name: 'Anna Huber',
    created_at: '2026-01-01T00:00:00.000Z',
    applied_at: '2026-01-01T01:00:00.000Z',
    undoable: true,
    cancellable: false,
  },
]

function renderHistory(role = 'ADMIN') {
  ;(authRole.useAuthRole as Mock).mockReturnValue(role)
  ;(importsApi.useImportJobs as Mock).mockReturnValue({
    data: { data: jobs, meta: { total: 2, page: 1, limit: 20 } },
    isLoading: false,
    isError: false,
  })
  ;(importsApi.useCancelImportJob as Mock).mockReturnValue({ mutate: vi.fn() })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    React.createElement(
      MemoryRouter,
      null,
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(DataImportHistoryView, { onOpenJob: vi.fn() }),
      ),
    ),
  )
}

describe('DataImportHistoryView', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => cleanup())

  it('renders localized status and entity labels, never raw enum values', async () => {
    renderHistory()

    expect(await screen.findByText(deEnums.status.APPLIED)).toBeInTheDocument()
    expect(screen.getByText(deEnums.status.DRY_RUN_DONE)).toBeInTheDocument()
    expect(screen.getByText(deEnums.importEntityType.CUSTOMER)).toBeInTheDocument()
    expect(screen.getByText(deEnums.importEntityType.VEHICLE)).toBeInTheDocument()

    expect(screen.queryByText('APPLIED')).toBeNull()
    expect(screen.queryByText('DRY_RUN_DONE')).toBeNull()
    expect(screen.queryByText('CUSTOMER')).toBeNull()
    expect(screen.queryByText('VEHICLE')).toBeNull()
  })

  it('WHEN an import run by a known user is listed THEN the user column shows that user name', async () => {
    renderHistory()

    expect(await screen.findByText('customers.csv')).toBeInTheDocument()
    expect(screen.getByText('vehicles.csv')).toBeInTheDocument()
    expect(
      screen.getByText(
        di.history.totals
          .replace('{{create}}', '1')
          .replace('{{update}}', '0')
          .replace('{{skip}}', '0')
          .replace('{{error}}', '0'),
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Anna Huber')).toBeInTheDocument()
  })

  it('WHEN the tenant has more than 100 members THEN names come from the history response and no member list is requested', async () => {
    renderHistory()

    expect(await screen.findByText('Anna Huber')).toBeInTheDocument()
    expect(vi.mocked(useTenantMembers)).not.toHaveBeenCalled()
  })

  it('WHEN the importing user was deleted THEN the column shows Unbekannt (DE) / Unknown (EN)', async () => {
    renderHistory()

    expect(await screen.findByText('Unbekannt')).toBeInTheDocument()
    expect(di.history.anonymousUser).toBe('Unbekannt')
    expect(enSettings.dataImport.history.anonymousUser).toBe('Unknown')
  })

  it('WHEN the Verlauf page loads THEN there is no console error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderHistory()

    expect(await screen.findByText('customers.csv')).toBeInTheDocument()
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
