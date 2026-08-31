import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { VehicleDataSettingsTab } from './VehicleDataSettingsTab'

const { mocks, defaultSettings } = vi.hoisted(() => {
  const defaultSettings = {
    id: 'settings-1',
    defaultIdentityAdapterId: null,
    defaultPartsAftermarketAdapterId: 'sandbox-aftermarket-parts',
    defaultLaborAftermarketAdapterId: 'sandbox-aftermarket-labor',
    defaultLaborCategoryId: 'labor-cat-1',
    defaultLaborCategory: {
      id: 'labor-cat-1',
      name: 'General Workshop',
      defaultHourlyRate: 95,
    },
    awMinutes: 6,
    hasIdentityCredential: false,
    hasPartsAftermarketCredential: true,
    hasLaborAftermarketCredential: false,
    oemConcerns: [
      {
        code: 'BMW' as const,
        partsAdapterId: 'sandbox-oem-bmw-parts',
        laborAdapterId: 'sandbox-oem-bmw-labor',
        hasPartsCredential: false,
        hasLaborCredential: false,
        memberMakes: [{ id: 1, name: 'BMW' }],
      },
      {
        code: 'MERCEDES' as const,
        partsAdapterId: 'sandbox-oem-mercedes-parts',
        laborAdapterId: 'sandbox-oem-mercedes-labor',
        hasPartsCredential: false,
        hasLaborCredential: false,
        memberMakes: [{ id: 2, name: 'Mercedes-Benz' }],
      },
      {
        code: 'STELLANTIS' as const,
        partsAdapterId: 'sandbox-oem-stellantis-parts',
        laborAdapterId: 'sandbox-oem-stellantis-labor',
        hasPartsCredential: true,
        hasLaborCredential: true,
        memberMakes: [
          { id: 3, name: 'Peugeot' },
          { id: 4, name: 'Citroën' },
          { id: 5, name: 'Opel' },
          { id: 6, name: 'Fiat' },
          { id: 7, name: 'Jeep' },
        ],
      },
    ],
    updatedAt: '2026-08-31T10:00:00.000Z',
  }

  const mocks = {
    activeRole: 'ADMIN' as string,
    settings: defaultSettings,
    isSettingsError: false,
    updateSettingsMutateAsync: vi.fn(),
    laborCategories: {
      data: [
        {
          id: 'labor-cat-1',
          name: 'General Workshop',
          children: [],
        },
      ],
    },
  }

  return { mocks, defaultSettings }
})

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/api/auth-session', () => ({
  useAuthSession: () => ({
    data: { activeRole: mocks.activeRole },
    isLoading: false,
  }),
}))

vi.mock('@/api/useCatalogProviderSettings', () => ({
  useCatalogProviderSettings: () => ({
    data: mocks.settings,
    isLoading: false,
    isError: mocks.isSettingsError,
  }),
  useUpdateCatalogProviderSettings: () => ({
    mutateAsync: mocks.updateSettingsMutateAsync,
    isPending: false,
  }),
}))

vi.mock('@/api/labor', () => ({
  useLaborCategories: () => ({
    data: { data: mocks.laborCategories.data },
    isLoading: false,
  }),
  flattenLaborCategories: (response?: { data?: { id: string; name: string; children: { id: string; name: string }[] }[] }) =>
    response?.data?.flatMap((category) => [
      { id: category.id, name: category.name },
      ...category.children.map((child) => ({
        id: child.id,
        name: `${category.name} › ${child.name}`,
      })),
    ]) ?? [],
}))

vi.mock('@/components/BrandMultiSelect', () => ({
  BrandMultiSelect: ({
    value,
    onChange,
    ariaLabel,
    disabled,
  }: {
    value: number[]
    onChange: (brandIds: number[]) => void
    ariaLabel?: string
    disabled?: boolean
  }) => (
    <input
      aria-label={ariaLabel}
      disabled={disabled}
      value={value.join(',')}
      onChange={(event) => {
        const nextValue = event.target.value
          .split(',')
          .map((entry) => Number.parseInt(entry, 10))
          .filter((entry) => !Number.isNaN(entry))
        onChange(nextValue)
      }}
    />
  ),
}))

function renderTab() {
  return render(
    <MemoryRouter>
      <VehicleDataSettingsTab />
    </MemoryRouter>,
  )
}

describe('VehicleDataSettingsTab', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    mocks.activeRole = 'ADMIN'
    mocks.settings = defaultSettings
    mocks.isSettingsError = false
    mocks.updateSettingsMutateAsync.mockReset()
    mocks.updateSettingsMutateAsync.mockResolvedValue(defaultSettings)
  })

  it('renders catalog defaults and Stellantis member makes for admins', () => {
    renderTab()

    expect(screen.getByText('Catalog defaults')).toBeInTheDocument()
    expect(screen.getByText('OEM concerns')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeInTheDocument()
    expect(screen.getByLabelText('Stellantis member makes')).toHaveValue('3,4,5,6,7')
    expect(screen.getByText('Aftermarket parts credentials configured')).toBeInTheDocument()
    expect(screen.getByText('OEM parts credentials')).toBeInTheDocument()
  })

  it('saves updated settings for admins', async () => {
    renderTab()

    fireEvent.change(screen.getByLabelText('AW minutes'), {
      target: { value: '8' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => {
      expect(mocks.updateSettingsMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          awMinutes: 8,
          oemConcerns: expect.arrayContaining([
            expect.objectContaining({
              code: 'STELLANTIS',
              memberBrandIds: [3, 4, 5, 6, 7],
            }),
          ]),
        }),
      )
    })
  })

  it('does not fetch or save for TECH users', () => {
    mocks.activeRole = 'TECH'
    renderTab()

    expect(screen.getByText(/owners and administrators only/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument()
  })
})
