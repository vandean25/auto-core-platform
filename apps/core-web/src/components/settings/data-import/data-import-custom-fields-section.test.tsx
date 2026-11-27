import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as authSessionApi from '@/api/auth-session'
import * as customFieldsApi from '@/api/custom-fields'

import deSettings from '../../../../../../locales/de/settings.json'

import { DataImportCustomFieldsSection } from './data-import-custom-fields-section'

const cfCopy = deSettings.dataImport.mapping.customFields

vi.mock('@/api/auth-session', () => ({
  useAuthSession: vi.fn(),
}))

vi.mock('@/api/custom-fields', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/custom-fields')>()
  return {
    ...actual,
    useCustomFieldDefinitions: vi.fn(),
    useCreateCustomFieldDefinition: vi.fn(),
  }
})

function renderSection(props?: Partial<React.ComponentProps<typeof DataImportCustomFieldsSection>>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const onMappingChange = vi.fn()
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <DataImportCustomFieldsSection
        entityType="CUSTOMER"
        unmappedHeaders={['Altsystem_Klasse']}
        mapping={{}}
        onMappingChange={onMappingChange}
        {...props}
      />
    </QueryClientProvider>,
  )
  return { ...utils, onMappingChange }
}

describe('DataImportCustomFieldsSection', () => {
  const mutateAsync = vi.fn()

  beforeEach(() => {
    mutateAsync.mockReset()
    ;(authSessionApi.useAuthSession as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { customFieldsEnabled: true, activeRole: 'ADMIN' },
    })
    ;(customFieldsApi.useCustomFieldDefinitions as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [
        {
          id: 'cf-1',
          entity: 'CUSTOMER',
          key: 'stammkunde',
          label: 'Stammkunde',
          type: 'TEXT',
          options: null,
          purpose: 'CRM',
          personal_data: true,
          retention_class: 'PARENT_OBJECT',
          archived: false,
          sort_order: 0,
        },
      ],
      isLoading: false,
    })
    ;(customFieldsApi.useCreateCustomFieldDefinition as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync,
      isPending: false,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('Scenario 4: hides the section when customFieldsEnabled is false', () => {
    ;(authSessionApi.useAuthSession as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { customFieldsEnabled: false, activeRole: 'ADMIN' },
    })

    const { container } = renderSection()
    expect(container.firstChild).toBeNull()
  })

  it('hides the section for non-admin roles', () => {
    ;(authSessionApi.useAuthSession as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { customFieldsEnabled: true, activeRole: 'SERVICE_ADVISOR' },
    })

    const { container } = renderSection()
    expect(container.firstChild).toBeNull()
  })

  it('Anti-criterion 1: prevents inline create when purpose is empty', async () => {
    renderSection()

    const selectTrigger = screen.getByRole('combobox', { name: /Altsystem_Klasse/i })
    fireEvent.click(selectTrigger)
    fireEvent.click(await screen.findByRole('option', { name: cfCopy.createNew }))

    expect(screen.getByLabelText(cfCopy.label)).toHaveValue('Altsystem_Klasse')
    fireEvent.click(screen.getByRole('button', { name: cfCopy.createAction }))

    expect(await screen.findByText(cfCopy.purposeRequiredError)).toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('Scenario 1: creates a new TEXT custom field inline and maps the column to custom_fields.<key>', async () => {
    mutateAsync.mockResolvedValue({
      id: 'cf-new',
      entity: 'CUSTOMER',
      key: 'altsystem_klasse',
      label: 'Altsystem_Klasse',
      type: 'TEXT',
      options: null,
      purpose: 'Altsystem Migration',
      personal_data: true,
      retention_class: 'PARENT_OBJECT',
      archived: false,
      sort_order: 1,
    })

    const { onMappingChange } = renderSection()

    fireEvent.click(screen.getByRole('combobox', { name: /Altsystem_Klasse/i }))
    fireEvent.click(await screen.findByRole('option', { name: cfCopy.createNew }))

    fireEvent.change(screen.getByLabelText(cfCopy.purpose), {
      target: { value: 'Altsystem Migration' },
    })
    fireEvent.click(screen.getByRole('button', { name: cfCopy.createAction }))

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'CUSTOMER',
          label: 'Altsystem_Klasse',
          type: 'TEXT',
          purpose: 'Altsystem Migration',
        }),
      )
    })
    expect(onMappingChange).toHaveBeenCalledWith('custom_fields.altsystem_klasse', 'Altsystem_Klasse')
  })

  it('Scenario 3: shows Art 9 confirmation checkbox on warning and sends confirmNoArt9: true on retry', async () => {
    mutateAsync
      .mockRejectedValueOnce({
        data: {
          code: 'CUSTOM_FIELD_ART9_CONFIRMATION_REQUIRED',
          message: 'Art 9 confirmation required',
        },
      })
      .mockResolvedValueOnce({
        id: 'cf-art9',
        entity: 'CUSTOMER',
        key: 'allergie_kaffee',
        label: 'Allergie Kaffee',
        type: 'TEXT',
        options: null,
        purpose: 'Kaffee',
        personal_data: true,
        retention_class: 'PARENT_OBJECT',
        archived: false,
        sort_order: 1,
      })

    const { onMappingChange } = renderSection({
      unmappedHeaders: ['Allergie Kaffee'],
    })

    fireEvent.click(screen.getByRole('combobox', { name: /Allergie Kaffee/i }))
    fireEvent.click(await screen.findByRole('option', { name: cfCopy.createNew }))

    fireEvent.change(screen.getByLabelText(cfCopy.purpose), {
      target: { value: 'Kaffee' },
    })
    fireEvent.click(screen.getByRole('button', { name: cfCopy.createAction }))

    const confirmCheckbox = await screen.findByLabelText(cfCopy.art9Confirm)
    fireEvent.click(confirmCheckbox)
    fireEvent.click(screen.getByRole('button', { name: cfCopy.createAction }))

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenLastCalledWith(
        expect.objectContaining({
          confirmNoArt9: true,
        }),
      )
    })
    expect(onMappingChange).toHaveBeenCalledWith('custom_fields.allergie_kaffee', 'Allergie Kaffee')
  })
})
