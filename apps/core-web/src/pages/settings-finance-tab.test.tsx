import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { registerGermanUiForTests } from '@/test/german-ui'
import deSettings from '../../../../locales/de/settings.json'
import { FinanceSettingsTab, useFinanceSettingsForm } from './settings-finance-tab'

const mockMutateAsync = vi.fn()
const mockSettings = {
  id: 'fs-1',
  tenant_id: 'tenant-1',
  fiscal_year_start_month: 1,
  lock_date: '2025-12-31T00:00:00.000Z',
  invoice_prefix: 'RE-2026-',
  next_invoice_number: 1001,
  sales_order_prefix: 'SO-2026-',
  next_sales_order_number: 1001,
  workshop_order_prefix: 'WO-2026-',
  next_workshop_order_number: 1,
}

vi.mock('@/api/useFinance', () => ({
  useFinanceSettings: () => ({
    data: mockSettings,
    isLoading: false,
  }),
  useUpdateFinanceSettings: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}))

registerGermanUiForTests()

function FinanceTabHarness({ canEdit }: { canEdit: boolean }) {
  const form = useFinanceSettingsForm()
  return <FinanceSettingsTab form={form} canManageExports={canEdit} canEdit={canEdit} />
}

describe('FinanceSettingsTab (AUT-1007)', () => {
  beforeEach(() => {
    mockMutateAsync.mockReset()
    mockMutateAsync.mockResolvedValue(mockSettings)
  })

  afterEach(() => {
    cleanup()
  })

  // AUT-1007 Scenario 5: non-admin (e.g. SALES) sees read-only fields
  it('renders fields as read-only when canEdit is false (e.g. SALES user)', () => {
    render(<FinanceTabHarness canEdit={false} />)

    expect(screen.getByLabelText(deSettings.finance.fiscal.lockDate)).toBeDisabled()
    expect(screen.getByLabelText(deSettings.finance.invoicing.prefix)).toBeDisabled()
    expect(screen.getByLabelText(deSettings.finance.invoicing.nextNumber)).toBeDisabled()
    expect(screen.queryByRole('button', { name: deSettings.finance.saveChanges })).not.toBeInTheDocument()
  })

  it('omits lock_date from PATCH payload when only invoice_prefix is edited', async () => {
    render(<FinanceTabHarness canEdit={true} />)

    const prefixInput = screen.getByLabelText(deSettings.finance.invoicing.prefix)
    fireEvent.change(prefixInput, { target: { value: 'RE-2027-' } })
    fireEvent.click(screen.getByRole('button', { name: deSettings.finance.saveChanges }))

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        invoice_prefix: 'RE-2027-',
        next_invoice_number: 1001,
      })
    })
  })

  it('sends lock_date: null when lock_date is cleared', async () => {
    render(<FinanceTabHarness canEdit={true} />)

    const lockDateInput = screen.getByLabelText(deSettings.finance.fiscal.lockDate)
    fireEvent.change(lockDateInput, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: deSettings.finance.saveChanges }))

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        lock_date: null,
        invoice_prefix: 'RE-2026-',
        next_invoice_number: 1001,
      })
    })
  })
})
