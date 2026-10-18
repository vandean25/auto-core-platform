import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import deInventory from '../../../../../locales/de/inventory.json'
import { registerGermanUiForTests } from '@/test/german-ui'
import { TyreSetFormDialog } from './TyreSetFormDialog'

registerGermanUiForTests()

vi.mock('@/api/locations', () => ({
  useLocations: () => ({ data: [] }),
}))

vi.mock('@/api/tyre-storage', () => ({
  useCreateTyreSet: () => ({ mutateAsync: vi.fn() }),
  useUpdateTyreSet: () => ({ mutateAsync: vi.fn() }),
}))

describe('TyreSetFormDialog', () => {
  it('hides storage location when editing an existing set', () => {
    render(
      <TyreSetFormDialog
        open
        onOpenChange={() => {}}
        customerId="cust-1"
        existing={{
          id: 'set-1',
          customerId: 'cust-1',
          siteId: 'site-1',
          label: 'Winter',
          season: 'WINTER',
          tyreCount: 4,
          rimType: 'NONE',
          status: 'IN_STORAGE',
          dotCodes: [],
        }}
      />,
    )

    expect(screen.queryByText(deInventory.tyreStorage.form.storageLocation)).not.toBeInTheDocument()
    expect(screen.getByText(deInventory.tyreStorage.form.editTitle)).toBeInTheDocument()
  })
})
