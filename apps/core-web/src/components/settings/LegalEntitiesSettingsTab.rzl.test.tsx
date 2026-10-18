import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AccountingProfileRecord, LegalEntityRecord } from '@/api/site-admin'

import { LegalEntityAccountingProfileForm } from './LegalEntitiesSettingsTab'
import deSettings from '../../../../../locales/de/settings.json'

const rzl = deSettings.legalEntities.profile.rzl

const updateMutateAsync = vi.fn()
let profileFixture: AccountingProfileRecord

vi.mock('@/api/site-admin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/site-admin')>()
  return {
    ...actual,
    useAccountingProfile: () => ({ data: profileFixture, isLoading: false }),
    useUpdateAccountingProfile: () => ({ mutateAsync: updateMutateAsync }),
  }
})

const atEntity = {
  id: 'legal-entity-at',
  tenant_id: 'tenant-1',
  name: 'Beispiel GmbH',
  country_iso: 'AT',
  is_active: true,
} as unknown as LegalEntityRecord

function rzlProfile(overrides: Partial<AccountingProfileRecord> = {}): AccountingProfileRecord {
  return {
    id: 'profile-at-1',
    tenant_id: 'tenant-1',
    legal_entity_id: 'legal-entity-at',
    version: 1,
    is_enabled: false,
    profile_code: 'ACP-RZL-AT-EUR-1',
    format_version: 'RZL-FIBU-IMPORT-ACP-DRAFT-1',
    chart: 'UGB',
    account_length: 4,
    advisor_number: null,
    client_number: null,
    fiscal_year_start_month: 1,
    default_debtor_account: '2000',
    serializer_params: {
      rzl: {
        firmNumber: 'FN-1',
        steuercodes: { vat20: '20', vat13: null, vat10: null },
      },
    },
    serializer_released: false,
    export_missing_fields: ['steuercode_vat13', 'steuercode_vat10'],
    mapping_rules: [],
    required_source_categories: [],
    mapping_readiness: { is_ready: true, missing_fields: [], unmapped_categories: [] },
    ...overrides,
  } as AccountingProfileRecord
}

beforeEach(() => {
  profileFixture = rzlProfile()
  updateMutateAsync.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('LegalEntityAccountingProfileForm (RZL)', () => {
  it('shows the RZL configuration with the release toggle disabled while the flag is off', () => {
    render(<LegalEntityAccountingProfileForm entity={atEntity} />)

    expect(screen.getByLabelText(rzl.firmNumber)).toHaveValue('FN-1')
    expect(screen.getByLabelText(rzl.steuercode20)).toHaveValue('20')
    expect(screen.getByLabelText(rzl.steuercode13)).toHaveValue('')
    expect(screen.getByLabelText(deSettings.legalEntities.profile.fields.formatVersion)).toBeDisabled()
    expect(screen.getByRole('checkbox')).toBeDisabled()
    expect(screen.getByText(rzl.notReleased)).toBeInTheDocument()
    expect(
      screen.getByText(
        deSettings.legalEntities.profile.exportMissingLine.replace(
          '{{fields}}',
          `${deSettings.legalEntities.profile.exportMissing.steuercodeVat13}, ${deSettings.legalEntities.profile.exportMissing.steuercodeVat10}`,
        ),
      ),
    ).toBeInTheDocument()
  })

  it('saves the pinned format version and Steuercodes after the suggested codes are applied', async () => {
    updateMutateAsync.mockResolvedValue({ ...profileFixture, version: 2 })
    render(<LegalEntityAccountingProfileForm entity={atEntity} />)

    fireEvent.click(screen.getByRole('button', { name: rzl.useSuggested }))

    await waitFor(
      () => {
        expect(updateMutateAsync).toHaveBeenCalled()
      },
      { timeout: 3000 },
    )
    expect(updateMutateAsync.mock.calls[0][0]).toMatchObject({
      legalEntityId: 'legal-entity-at',
      formatVersion: 'RZL-FIBU-IMPORT-ACP-DRAFT-1',
      serializerParams: {
        rzl: {
          firmNumber: 'FN-1',
          steuercodes: { vat20: '20', vat13: '13', vat10: '10' },
        },
      },
    })
  })

  it('enables the release toggle when the platform flag is on', () => {
    profileFixture = rzlProfile({
      serializer_released: true,
      export_missing_fields: [],
      serializer_params: {
        rzl: {
          firmNumber: 'FN-1',
          steuercodes: { vat20: '20', vat13: '13', vat10: '10' },
        },
      },
    })
    render(<LegalEntityAccountingProfileForm entity={atEntity} />)

    expect(screen.getByRole('checkbox')).toBeEnabled()
    expect(screen.getByText(rzl.released)).toBeInTheDocument()
    expect(screen.queryByText(/Für den Export fehlt/)).not.toBeInTheDocument()
  })
})
