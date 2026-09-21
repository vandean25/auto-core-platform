import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AccountingExportSettingsTab } from './AccountingExportSettingsTab'

afterEach(() => {
  cleanup()
})

vi.mock('@/api/site-admin', () => ({
  useLegalEntities: () => ({ data: [], isLoading: false }),
}))

vi.mock('@/api/useAccountingExports', () => ({
  usePreviewAccountingExport: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useGenerateAccountingExport: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAccountingExports: () => ({ data: { data: [], meta: { pageCount: 1 } }, isLoading: false }),
  useAccountingExportDetail: () => ({ data: null, isLoading: false }),
  computeBlobSha256Hex: vi.fn(),
  downloadAccountingExportCsv: vi.fn(),
}))

vi.mock('@/components/settings/LegalEntitiesSettingsTab', () => ({
  LegalEntityAccountingProfileForm: () => <div>Profile form</div>,
}))

describe('AccountingExportSettingsTab', () => {
  it('shows access message for non-admin users', () => {
    render(
      <MemoryRouter>
        <AccountingExportSettingsTab canManageExports={false} />
      </MemoryRouter>,
    )

    expect(
      screen.getByText(/Only tenant OWNER and ADMIN users/i),
    ).toBeInTheDocument()
  })

  it('prompts for legal entities when admin and list is empty', () => {
    render(
      <MemoryRouter>
        <AccountingExportSettingsTab canManageExports={true} />
      </MemoryRouter>,
    )

    expect(
      screen.getByText(/Create a legal entity before configuring DATEV accounting export/i),
    ).toBeInTheDocument()
  })
})
