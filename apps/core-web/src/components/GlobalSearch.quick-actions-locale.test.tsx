import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { changeUiLanguage } from '@/lib/i18n'
import { GlobalSearch } from './GlobalSearch'
import * as searchHook from '@/hooks/useGlobalSearch'

vi.mock('@/hooks/useGlobalSearch')

describe('GlobalSearch quick actions locale', () => {
  beforeEach(async () => {
    await changeUiLanguage('de')
    vi.clearAllMocks()
    vi.mocked(searchHook.useGlobalSearch).mockReturnValue({
      data: { inventory: [], customers: [], vehicles: [], orders: [] },
      isLoading: false,
      isFetching: false,
      error: null,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('rebuilds quick actions when the UI language changes without a new query', async () => {
    const { rerender } = render(
      <MemoryRouter>
        <GlobalSearch open={true} onOpenChange={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Dashboard öffnen')).toBeInTheDocument()

    rerender(
      <MemoryRouter>
        <GlobalSearch open={false} onOpenChange={vi.fn()} />
      </MemoryRouter>,
    )

    await changeUiLanguage('en')

    rerender(
      <MemoryRouter>
        <GlobalSearch open={true} onOpenChange={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Open Dashboard')).toBeInTheDocument()
    expect(screen.queryByText('Dashboard öffnen')).not.toBeInTheDocument()

    await changeUiLanguage('de')
  })
})
