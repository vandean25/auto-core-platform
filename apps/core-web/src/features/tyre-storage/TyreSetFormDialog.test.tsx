import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import deInventory from '../../../../../locales/de/inventory.json'
import { registerGermanUiForTests } from '@/test/german-ui'
import { TyreSetFormDialog } from './TyreSetFormDialog'

registerGermanUiForTests()

const mockLocations = vi.fn().mockReturnValue({ data: [] })

vi.mock('@/api/locations', () => ({
  useLocations: () => mockLocations(),
}))

vi.mock('@/api/tyre-storage', () => ({
  useCreateTyreSet: () => ({ mutateAsync: vi.fn() }),
  useUpdateTyreSet: () => ({ mutateAsync: vi.fn() }),
}))

describe('TyreSetFormDialog', () => {
  it('hides storage location when editing an existing set', () => {
    mockLocations.mockReturnValue({ data: [] })

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

  it('renders storage location option with special characters (e.g. Halle A/B) without HTML entities', async () => {
    mockLocations.mockReturnValue({
      data: [
        {
          id: 'loc-1',
          code: 'LOC-1',
          name: 'Halle A/B & "x" \'y\'',
          type: 'customer_storage',
        },
      ],
    })

    Object.assign(Element.prototype, {
      hasPointerCapture: () => false,
      setPointerCapture: () => undefined,
      releasePointerCapture: () => undefined,
      scrollIntoView: () => undefined,
    })

    render(
      <TyreSetFormDialog
        open
        onOpenChange={() => {}}
        customerId="cust-1"
        existing={null}
      />,
    )

    expect(screen.getByText(deInventory.tyreStorage.form.storageLocation)).toBeInTheDocument()

    // Find the storage location select trigger
    const locationLabel = screen.getByText(deInventory.tyreStorage.form.storageLocation)
    const locationContainer = locationLabel.closest('div')!
    const locationTrigger = locationContainer.querySelector('button[role="combobox"]')!

    fireEvent.pointerDown(locationTrigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })

    const option = await screen.findByRole('option', {
      name: 'LOC-1 — Halle A/B & "x" \'y\'',
    })
    expect(option).toBeInTheDocument()
    expect(option.textContent).toBe('LOC-1 — Halle A/B & "x" \'y\'')
    expect(option.textContent).not.toContain('&#x2F;')
    expect(option.textContent).not.toContain('&amp;')
    expect(option.textContent).not.toContain('&quot;')
    expect(option.textContent).not.toContain('&#39;')
    expect(option.textContent).not.toContain('&#x27;')
    expect(option.innerHTML).not.toContain('&#x2F;')
    expect(option.innerHTML).not.toContain('&amp;amp;')
  })
})
