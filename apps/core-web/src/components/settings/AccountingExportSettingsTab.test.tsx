import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AccountingExportSettingsTab } from './AccountingExportSettingsTab'

afterEach(() => {
  cleanup()
})

const mockEntity = {
  id: 'legal-entity-1',
  tenant_id: 'tenant-1',
  name: 'Example GmbH',
  country_iso: 'DE' as const,
  is_active: true,
  address_street: null,
  address_line2: null,
  address_zip: null,
  address_city: null,
  tax_number: null,
  vat_id: null,
  iban: null,
  bic: null,
  bank_name: null,
  email: null,
  phone: null,
  registration_number: null,
  registration_court: null,
  representatives: null,
  payment_terms_days: null,
  payment_terms_text: null,
  seller_readiness: { is_ready: true, missing_fields: [] },
}

const previewResult = {
  legalEntityId: 'legal-entity-1',
  dateFrom: '2026-01-01',
  dateTo: '2026-01-31',
  profileVersion: 2,
  previewHash: 'preview-hash',
  documentCount: 1,
  rowCount: 1,
  totals: [{ account: '8400', taxRate: '19.00', net: '100.00', tax: '19.00', gross: '119.00' }],
  blockers: [],
  overlaps: [],
  canGenerate: true,
}

const historyRun = {
  id: 'export-run-1',
  legalEntityId: 'legal-entity-1',
  dateFrom: '2026-01-01',
  dateTo: '2026-01-31',
  filename: 'export.csv',
  sha256: 'abc',
  documentCount: 1,
  rowCount: 1,
  byteLength: 10,
  createdAt: '2026-09-21T12:00:00.000Z',
  createdByUserId: 'user-admin-1',
}

const previewMutateAsync = vi.fn()
const generateMutateAsync = vi.fn()

vi.mock('@/api/site-admin', () => ({
  useLegalEntities: () => ({ data: [mockEntity], isLoading: false }),
}))

vi.mock('@/api/tenant-members', () => ({
  useTenantMembers: () => ({
    data: {
      data: [
        {
          id: 'member-1',
          tenantId: 'tenant-1',
          userId: 'user-admin-1',
          email: 'admin@example.com',
          firstName: 'Ada',
          lastName: 'Admin',
          role: 'ADMIN',
          isActive: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      meta: { total: 1, page: 1, limit: 100, totalPages: 1 },
    },
  }),
}))

vi.mock('@/api/useAccountingExports', () => ({
  usePreviewAccountingExport: () => ({
    mutateAsync: previewMutateAsync,
    isPending: false,
  }),
  useGenerateAccountingExport: () => ({
    mutateAsync: generateMutateAsync,
    isPending: false,
  }),
  useAccountingExports: () => ({
    data: { data: [historyRun], meta: { pageCount: 1, total: 1, page: 1, limit: 10 } },
    isLoading: false,
  }),
  useAccountingExportDetail: () => ({ data: null, isLoading: false }),
  downloadAccountingExportCsv: vi.fn(),
}))

vi.mock('@/components/settings/LegalEntitiesSettingsTab', () => ({
  LegalEntityAccountingProfileForm: ({
    onSaveStatusChange,
  }: {
    onSaveStatusChange?: (status: 'idle' | 'saving' | 'saved' | 'error') => void
  }) => (
    <button
      type="button"
      onClick={() => {
        onSaveStatusChange?.('saving')
        onSaveStatusChange?.('saved')
      }}
    >
      Simulate profile save
    </button>
  ),
}))

describe('AccountingExportSettingsTab', () => {
  it('shows access message for non-admin users', () => {
    render(
      <MemoryRouter>
        <AccountingExportSettingsTab canManageExports={false} />
      </MemoryRouter>,
    )

    expect(screen.getByText(/Only tenant OWNER and ADMIN users/i)).toBeInTheDocument()
  })

  it('renders generated-by actor label in run history', async () => {
    render(
      <MemoryRouter>
        <AccountingExportSettingsTab canManageExports={true} />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('cell', { name: 'Ada Admin' })).toBeInTheDocument()
  })

  it('clears preview after profile autosave so Generate stays disabled', async () => {
    previewMutateAsync.mockResolvedValue(previewResult)

    render(
      <MemoryRouter>
        <AccountingExportSettingsTab canManageExports={true} />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('Date from'), { target: { value: '2026-01-01' } })
    fireEvent.change(screen.getByLabelText('Date to'), { target: { value: '2026-01-31' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    await waitFor(() => {
      expect(screen.getByText('Preview results')).toBeInTheDocument()
    })

    const generateButton = screen.getByRole('button', { name: 'Generate' })
    expect(generateButton).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Simulate profile save' }))

    await waitFor(() => {
      expect(screen.queryByText('Preview results')).not.toBeInTheDocument()
      expect(generateButton).toBeDisabled()
    })
  })
})
