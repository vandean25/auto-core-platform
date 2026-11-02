import * as React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import type { ImportJobListItem } from '@/api/imports'
import * as importsApi from '@/api/imports'
import * as tenantMembersApi from '@/api/tenant-members'
import * as authRole from '@/features/actions/use-auth-role'

import deEnums from '../../../../../../locales/de/enums.json'
import deSettings from '../../../../../../locales/de/settings.json'

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
  ;(tenantMembersApi.useTenantMembers as Mock).mockReturnValue({
    data: {
      data: [
        {
          id: 'member-1',
          tenantId: 'tenant-1',
          userId: 'user-1',
          email: 'anna.huber@example.com',
          firstName: 'Anna',
          lastName: 'Huber',
          role: 'ADMIN',
          isActive: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      meta: { total: 1, page: 1, limit: 200 },
    },
  })
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

  it('shows the file name, totals and the resolved user', async () => {
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
    expect(screen.getByText(di.history.anonymousUser)).toBeInTheDocument()
  })
})
