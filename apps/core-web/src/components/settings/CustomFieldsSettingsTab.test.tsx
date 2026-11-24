import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CustomFieldsSettingsTab } from './CustomFieldsSettingsTab'

const mockFetchJsonWithAuth = vi.fn()

vi.mock('@/api/api-error', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/api-error')>()
  return {
    ...actual,
    fetchJsonWithAuth: (...args: unknown[]) => mockFetchJsonWithAuth(...args),
  }
})

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <CustomFieldsSettingsTab />
    </QueryClientProvider>,
  )
}

describe('CustomFieldsSettingsTab', () => {
  afterEach(() => {
    mockFetchJsonWithAuth.mockReset()
  })

  it('renders legal notice and existing definitions', async () => {
    mockFetchJsonWithAuth.mockResolvedValue([
      {
        id: 'def-1',
        entity: 'CUSTOMER',
        key: 'flottennummer',
        label: 'Flottennummer',
        type: 'TEXT',
        options: null,
        purpose: 'Flottenabrechnung',
        personal_data: true,
        retention_class: 'PARENT_OBJECT',
        archived: false,
        sort_order: 0,
        createdAt: '2026-11-24T00:00:00.000Z',
        updatedAt: '2026-11-24T00:00:00.000Z',
      },
    ])

    renderTab()

    expect(
      await screen.findByText(/Verantwortlicher für diese Felder/i),
    ).toBeInTheDocument()
    expect(await screen.findByText('Flottennummer')).toBeInTheDocument()
    expect(screen.getByText('Flottenabrechnung')).toBeInTheDocument()
  })

  it('shows vehicle personal-data review hint when personal_data is unchecked for VEHICLE', async () => {
    mockFetchJsonWithAuth.mockResolvedValue([])

    renderTab()

    fireEvent.click(await screen.findByRole('button', { name: 'Fahrzeuge' }))
    fireEvent.click(screen.getByRole('button', { name: /Eigenes Feld/i }))

    const checkbox = await screen.findByRole('checkbox', {
      name: /Personenbezogene Daten/i,
    })
    expect(checkbox).toBeChecked()
    fireEvent.click(checkbox)

    await waitFor(() => {
      expect(
        screen.getByText(/wirklich keinen Personenbezug hat/i),
      ).toBeInTheDocument()
    })
  })

  it('shows customer personal-data review hint when personal_data is unchecked for CUSTOMER', async () => {
    mockFetchJsonWithAuth.mockResolvedValue([])

    renderTab()

    fireEvent.click(await screen.findByRole('button', { name: /Eigenes Feld/i }))

    const checkbox = await screen.findByRole('checkbox', {
      name: /Personenbezogene Daten/i,
    })
    expect(checkbox).toBeChecked()
    fireEvent.click(checkbox)

    await waitFor(() => {
      expect(
        screen.getByText(/dieses Kundenfeld wirklich keinen Personenbezug hat/i),
      ).toBeInTheDocument()
    })
  })

  it('shows loadFailed message with retry button when loading definitions fails', async () => {
    mockFetchJsonWithAuth
      .mockRejectedValueOnce(new Error('HTTP 500'))
      .mockResolvedValueOnce([])

    renderTab()

    expect(
      await screen.findByText('Eigene Felder konnten nicht geladen werden.'),
    ).toBeInTheDocument()
    const retryButton = screen.getByRole('button', { name: /Erneut versuchen/i })
    fireEvent.click(retryButton)

    await waitFor(() => {
      expect(
        screen.getByText('Noch keine eigenen Felder angelegt.'),
      ).toBeInTheDocument()
    })
  })
})
