import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { useBays } from '@/api/bays'
import deSettings from '../../../../../locales/de/settings.json'
import { BaySettingsTab } from './BaySettingsTab'

vi.mock('@/api/bays', () => ({
  useBays: vi.fn(() => ({
    data: {
      data: [],
      meta: { total: 0, page: 1, limit: 100, totalPages: 1 },
    },
    isLoading: false,
  })),
  useCreateBay: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateBay: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteBay: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

describe('BaySettingsTab', () => {
  it('renders title and top-right create action', () => {
    render(
      <MemoryRouter>
        <BaySettingsTab />
      </MemoryRouter>,
    )

    expect(screen.getByText(deSettings.bays.title)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: deSettings.bays.createButton })).toBeInTheDocument()
    expect(vi.mocked(useBays)).toHaveBeenCalledWith({
      includeInactive: true,
      limit: 100,
    })
  })

  // AUT-952: Kompakte Texte — active bay rows show no repeated Aktiv badge.
  it('WHEN active and inactive bays are rendered THEN active rows omit Aktiv while inactive rows show Inaktiv', () => {
    vi.mocked(useBays).mockReturnValueOnce({
      data: {
        data: [
          { id: 'bay-1', name: 'Bühne 1', isActive: true, sortOrder: 1 },
          { id: 'bay-2', name: 'Bühne 2', isActive: false, sortOrder: 2 },
        ],
        meta: { total: 2, page: 1, limit: 100, totalPages: 1 },
      },
      isLoading: false,
    } as never)

    render(
      <MemoryRouter>
        <BaySettingsTab />
      </MemoryRouter>,
    )

    const activeRow = screen.getByText('Bühne 1').closest('tr')!
    expect(activeRow).not.toHaveTextContent(deSettings.bays.active)
    expect(screen.getByText(deSettings.bays.inactive)).toBeInTheDocument()
  })
})

