import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CustomFieldsSection } from './CustomFieldsSection'

const mockUseAuthSession = vi.fn()
const mockUseCustomFieldDefinitions = vi.fn()

vi.mock('@/api/auth-session', () => ({
  useAuthSession: () => mockUseAuthSession(),
}))

vi.mock('@/api/custom-fields', () => ({
  useCustomFieldDefinitions: (...args: unknown[]) =>
    mockUseCustomFieldDefinitions(...args),
}))

function renderSection(props: {
  values?: Record<string, unknown>
  onSaveField?: (key: string, value: string | number | boolean | null) => Promise<unknown>
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <CustomFieldsSection
        entity="CUSTOMER"
        values={props.values ?? {}}
        onSaveField={props.onSaveField ?? vi.fn().mockResolvedValue(undefined)}
      />
    </QueryClientProvider>,
  )
}

describe('CustomFieldsSection', () => {
  afterEach(() => {
    mockUseAuthSession.mockReset()
    mockUseCustomFieldDefinitions.mockReset()
  })

  it('hides custom fields section when feature flag is OFF', () => {
    mockUseAuthSession.mockReturnValue({ data: { customFieldsEnabled: false } })
    mockUseCustomFieldDefinitions.mockReturnValue({ data: [] })

    renderSection({})
    expect(screen.queryByTestId('custom-fields-section-customer')).not.toBeInTheDocument()
  })

  it('renders active custom fields and saves inline edit when flag is ON', async () => {
    const onSaveField = vi.fn().mockResolvedValue(undefined)
    mockUseAuthSession.mockReturnValue({ data: { customFieldsEnabled: true } })
    mockUseCustomFieldDefinitions.mockReturnValue({
      data: [
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
        },
      ],
    })

    renderSection({ values: { flottennummer: 'FL-10' }, onSaveField })

    expect(screen.getByTestId('custom-fields-section-customer')).toBeInTheDocument()
    const trigger = screen.getByRole('button', { name: 'FL-10' })
    fireEvent.click(trigger)

    const input = await screen.findByRole('textbox', { name: 'Flottennummer' })
    fireEvent.change(input, { target: { value: 'FL-99' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(onSaveField).toHaveBeenCalledWith('flottennummer', 'FL-99')
    })
  })
})
