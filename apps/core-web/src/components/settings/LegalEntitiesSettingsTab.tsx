import * as React from 'react'
import type { TFunction } from 'i18next'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  type AccountingMappingRule,
  type AccountingProfileRecord,
  type LegalEntityRecord,
  type SourceCategoryDefinition,
  type UpdateAccountingProfilePayload,
  type UpdateLegalEntityPayload,
  useAccountingProfile,
  useCreateLegalEntity,
  useLegalEntities,
  useUpdateAccountingProfile,
  useUpdateLegalEntity,
  type AccountingSerializerParams,
} from '@/api/site-admin'
import { DocumentSaveIndicator } from '@/components/document-save/DocumentSaveIndicator'
import { DocumentBrandingSettings } from '@/components/settings/document-branding/DocumentBrandingSettings'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useDebouncedAutoSave, type DocumentSaveStatus } from '@/hooks/useDebouncedAutoSave'
import { formatPercent } from '@/lib/format'

type SellerFormState = {
  name: string
  addressStreet: string
  addressLine2: string
  addressZip: string
  addressCity: string
  taxNumber: string
  vatId: string
  iban: string
  bic: string
  bankName: string
  email: string
  phone: string
  registrationNumber: string
  registrationCourt: string
  representatives: string
  paymentTermsDays: string
  paymentTermsText: string
  rksvMode: LegalEntityRecord['rksv_mode']
}

function toFormState(entity: LegalEntityRecord): SellerFormState {
  return {
    name: entity.name,
    addressStreet: entity.address_street ?? '',
    addressLine2: entity.address_line2 ?? '',
    addressZip: entity.address_zip ?? '',
    addressCity: entity.address_city ?? '',
    taxNumber: entity.tax_number ?? '',
    vatId: entity.vat_id ?? '',
    iban: entity.iban ?? '',
    bic: entity.bic ?? '',
    bankName: entity.bank_name ?? '',
    email: entity.email ?? '',
    phone: entity.phone ?? '',
    registrationNumber: entity.registration_number ?? '',
    registrationCourt: entity.registration_court ?? '',
    representatives: entity.representatives ?? '',
    paymentTermsDays:
      entity.payment_terms_days === null ? '' : String(entity.payment_terms_days),
    paymentTermsText: entity.payment_terms_text ?? '',
    rksvMode: entity.rksv_mode ?? 'OFF',
  }
}

function normalizeOptionalFormString(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function buildUpdatePayload(
  entityId: string,
  form: SellerFormState,
): UpdateLegalEntityPayload {
  const paymentTermsDays =
    form.paymentTermsDays.trim() === ''
      ? null
      : Number.parseInt(form.paymentTermsDays, 10)

  return {
    id: entityId,
    name: form.name.trim(),
    addressStreet: normalizeOptionalFormString(form.addressStreet),
    addressLine2: normalizeOptionalFormString(form.addressLine2),
    addressZip: normalizeOptionalFormString(form.addressZip),
    addressCity: normalizeOptionalFormString(form.addressCity),
    taxNumber: normalizeOptionalFormString(form.taxNumber),
    vatId: normalizeOptionalFormString(form.vatId),
    iban: normalizeOptionalFormString(form.iban),
    bic: normalizeOptionalFormString(form.bic),
    bankName: normalizeOptionalFormString(form.bankName),
    email: normalizeOptionalFormString(form.email),
    phone: normalizeOptionalFormString(form.phone),
    registrationNumber: normalizeOptionalFormString(form.registrationNumber),
    registrationCourt: normalizeOptionalFormString(form.registrationCourt),
    representatives: normalizeOptionalFormString(form.representatives),
    paymentTermsDays,
    paymentTermsText: normalizeOptionalFormString(form.paymentTermsText),
    rksvMode: form.rksvMode,
  }
}

function formatMissingField(field: string, countryIso: 'AT' | 'DE', t: TFunction<'settings'>) {
  switch (field) {
    case 'tax_number_or_vat_id':
      return t('legalEntities.seller.missing.taxNumberOrVatId')
    case 'vat_id':
      return countryIso === 'AT'
        ? t('legalEntities.seller.missing.vatIdAt')
        : t('legalEntities.seller.missing.vatIdDe')
    case 'payment_terms_days':
      return t('legalEntities.seller.missing.paymentTermsDays')
    case 'payment_terms_text':
      return t('legalEntities.seller.missing.paymentTermsText')
    case 'address_street':
      return t('legalEntities.seller.missing.addressStreet')
    case 'address_zip':
      return t('legalEntities.seller.missing.addressZip')
    case 'address_city':
      return t('legalEntities.seller.missing.addressCity')
    default:
      return field.replaceAll('_', ' ')
  }
}

const RZL_PROFILE_CODE = 'ACP-RZL-AT-EUR-1'
const RZL_FORMAT_VERSION = 'RZL-FIBU-IMPORT-ACP-DRAFT-1'
const RZL_STEUERCODE_SUGGESTIONS = { vat20: '20', vat13: '13', vat10: '10' } as const

type ProfileFormState = {
  advisorNumber: string
  clientNumber: string
  accountLength: string
  defaultDebtorAccount: string
  fiscalYearStartMonth: string
  chart: string
  profileCode: string
  formatVersion: string
  isEnabled: boolean
  mappingRules: AccountingMappingRule[]
  rzlFirmNumber: string
  rzlCostCenterLength: string
  rzlSteuercodeVat20: string
  rzlSteuercodeVat13: string
  rzlSteuercodeVat10: string
}

function toProfileFormState(profile: AccountingProfileRecord): ProfileFormState {
  return {
    advisorNumber: profile.advisor_number ?? '',
    clientNumber: profile.client_number ?? '',
    accountLength:
      profile.account_length === null ? '' : String(profile.account_length),
    defaultDebtorAccount: profile.default_debtor_account ?? '',
    fiscalYearStartMonth:
      profile.fiscal_year_start_month === null
        ? ''
        : String(profile.fiscal_year_start_month),
    chart: profile.chart ?? '',
    profileCode: profile.profile_code ?? '',
    formatVersion: profile.format_version ?? '',
    isEnabled: profile.is_enabled,
    mappingRules: profile.mapping_rules,
    rzlFirmNumber: profile.serializer_params.rzl?.firmNumber ?? '',
    rzlCostCenterLength:
      profile.serializer_params.rzl?.costCenterLength == null
        ? ''
        : String(profile.serializer_params.rzl.costCenterLength),
    rzlSteuercodeVat20: profile.serializer_params.rzl?.steuercodes?.vat20 ?? '',
    rzlSteuercodeVat13: profile.serializer_params.rzl?.steuercodes?.vat13 ?? '',
    rzlSteuercodeVat10: profile.serializer_params.rzl?.steuercodes?.vat10 ?? '',
  }
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function buildRzlSerializerParams(form: ProfileFormState): AccountingSerializerParams {
  const costCenterLength =
    form.rzlCostCenterLength.trim() === ''
      ? null
      : Number.parseInt(form.rzlCostCenterLength, 10)
  return {
    rzl: {
      firmNumber: blankToNull(form.rzlFirmNumber),
      costCenterLength,
      steuercodes: {
        vat20: blankToNull(form.rzlSteuercodeVat20),
        vat13: blankToNull(form.rzlSteuercodeVat13),
        vat10: blankToNull(form.rzlSteuercodeVat10),
      },
    },
  }
}

function findMappingRule(
  rules: AccountingMappingRule[],
  category: SourceCategoryDefinition,
): AccountingMappingRule | undefined {
  return rules.find(
    (rule) =>
      rule.sourceCategoryKey === category.key &&
      rule.taxMode === category.taxMode &&
      rule.taxRate === category.taxRate,
  )
}

function upsertMappingRule(
  rules: AccountingMappingRule[],
  category: SourceCategoryDefinition,
  updates: Partial<AccountingMappingRule>,
): AccountingMappingRule[] {
  const existing = findMappingRule(rules, category)
  const nextRule: AccountingMappingRule = {
    sourceCategoryKey: category.key,
    sourceCategoryLabel: category.label,
    taxMode: category.taxMode,
    taxRate: category.taxRate,
    revenueAccount: existing?.revenueAccount ?? category.suggestedRevenueAccount ?? '',
    taxTreatment: existing?.taxTreatment ?? 'automatic',
    buKey: existing?.buKey ?? null,
    ...updates,
  }

  const withoutCurrent = rules.filter(
    (rule) =>
      !(
        rule.sourceCategoryKey === category.key &&
        rule.taxMode === category.taxMode &&
        rule.taxRate === category.taxRate
      ),
  )

  return [...withoutCurrent, nextRule]
}

function buildProfileUpdatePayload(
  legalEntityId: string,
  version: number,
  form: ProfileFormState,
): UpdateAccountingProfilePayload {
  const accountLength =
    form.accountLength.trim() === '' ? null : Number.parseInt(form.accountLength, 10)
  const fiscalYearStartMonth =
    form.fiscalYearStartMonth.trim() === ''
      ? null
      : Number.parseInt(form.fiscalYearStartMonth, 10)
  const isRzl = form.profileCode === RZL_PROFILE_CODE

  return {
    legalEntityId,
    expectedVersion: version,
    advisorNumber: form.advisorNumber,
    clientNumber: form.clientNumber,
    accountLength,
    defaultDebtorAccount: form.defaultDebtorAccount,
    fiscalYearStartMonth,
    chart: form.chart,
    profileCode: form.profileCode,
    formatVersion: isRzl ? RZL_FORMAT_VERSION : form.formatVersion,
    isEnabled: form.isEnabled,
    mappingRules: form.mappingRules.filter(
      (rule) => rule.revenueAccount.trim().length > 0,
    ),
    ...(isRzl ? { serializerParams: buildRzlSerializerParams(form) } : {}),
  }
}

function formatRzlExportMissingField(field: string, t: TFunction<'settings'>) {
  switch (field) {
    case 'firm_number':
      return t('legalEntities.profile.exportMissing.firmNumber')
    case 'steuercode_vat20':
      return t('legalEntities.profile.exportMissing.steuercodeVat20')
    case 'steuercode_vat13':
      return t('legalEntities.profile.exportMissing.steuercodeVat13')
    case 'steuercode_vat10':
      return t('legalEntities.profile.exportMissing.steuercodeVat10')
    case 'format_version':
      return t('legalEntities.profile.exportMissing.formatVersion')
    case 'chart':
      return t('legalEntities.profile.exportMissing.chart')
    case 'account_length':
      return t('legalEntities.profile.exportMissing.accountLength')
    case 'default_debtor_account':
      return t('legalEntities.profile.exportMissing.defaultDebtorAccount')
    default:
      return field.replaceAll('_', ' ')
  }
}

function formatProfileMissingField(field: string, t: TFunction<'settings'>) {
  switch (field) {
    case 'advisor_number':
      return t('legalEntities.profile.missing.advisorNumber')
    case 'client_number':
      return t('legalEntities.profile.missing.clientNumber')
    case 'account_length':
      return t('legalEntities.profile.missing.accountLength')
    case 'default_debtor_account':
      return t('legalEntities.profile.missing.defaultDebtorAccount')
    case 'mapping_rules':
      return t('legalEntities.profile.missing.mappingRules')
    default:
      return field.replaceAll('_', ' ')
  }
}

export function LegalEntityAccountingProfileForm({
  entity,
  onSaveStatusChange,
}: {
  entity: LegalEntityRecord
  onSaveStatusChange?: (status: DocumentSaveStatus) => void
}) {
  const { t } = useTranslation('settings')
  const { data: profile, isLoading } = useAccountingProfile(entity.id)
  const updateMutation = useUpdateAccountingProfile()
  const [form, setForm] = React.useState<ProfileFormState | null>(null)
  const [version, setVersion] = React.useState(1)
  const lastSavedRef = React.useRef('')
  const updateMutationRef = React.useRef(updateMutation)
  const versionRef = React.useRef(1)
  const previousEntityIdRef = React.useRef(entity.id)

  React.useEffect(() => {
    updateMutationRef.current = updateMutation
  })

  React.useEffect(() => {
    if (!profile) {
      return
    }

    if (previousEntityIdRef.current !== entity.id) {
      const nextForm = toProfileFormState(profile)
      setForm(nextForm)
      setVersion(profile.version)
      versionRef.current = profile.version
      lastSavedRef.current = JSON.stringify(nextForm)
      previousEntityIdRef.current = entity.id
      return
    }

    if (!form) {
      const nextForm = toProfileFormState(profile)
      setForm(nextForm)
      setVersion(profile.version)
      versionRef.current = profile.version
      lastSavedRef.current = JSON.stringify(nextForm)
    }
  }, [entity.id, form, profile])

  const saveProfile = React.useCallback(
    async (snapshot: ProfileFormState, signal: AbortSignal) => {
      const serialized = JSON.stringify(snapshot)
      if (serialized === lastSavedRef.current) {
        return
      }

      const updated = await updateMutationRef.current.mutateAsync(
        buildProfileUpdatePayload(entity.id, versionRef.current, snapshot),
      )
      if (signal.aborted) {
        return
      }

      lastSavedRef.current = serialized
      versionRef.current = updated.version
      setVersion(updated.version)
    },
    [entity.id],
  )

  const { saveStatus, triggerAutoSave } = useDebouncedAutoSave({
    save: saveProfile,
    shouldSave: () => true,
  })

  React.useEffect(() => {
    onSaveStatusChange?.(saveStatus)
  }, [onSaveStatusChange, saveStatus])

  const updateForm = (updater: (current: ProfileFormState) => ProfileFormState) => {
    setForm((current) => {
      if (!current) {
        return current
      }
      const next = updater(current)
      triggerAutoSave(next)
      return next
    })
  }

  const updateMappingField = (
    category: SourceCategoryDefinition,
    updates: Partial<AccountingMappingRule>,
  ) => {
    updateForm((current) => ({
      ...current,
      mappingRules: upsertMappingRule(current.mappingRules, category, updates),
    }))
  }

  if (isLoading || !profile || !form) {
    return (
      <div className="flex min-h-[160px] items-center justify-center rounded-lg border bg-white p-6 shadow-sm">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const readiness = profile.mapping_readiness

  return (
    <div className="space-y-6 rounded-lg border bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="font-medium">{t('legalEntities.profile.title')}</h4>
          <p className="text-sm text-slate-500">
            {t('legalEntities.profile.description', { name: entity.name })}
          </p>
        </div>
        <DocumentSaveIndicator status={saveStatus} />
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center gap-3">
          <StatusBadge status={readiness.is_ready ? 'ACTIVE' : 'INACTIVE'} />
          <span className="text-sm font-medium text-slate-700">
            {readiness.is_ready
              ? t('legalEntities.profile.ready')
              : t('legalEntities.profile.incomplete')}
          </span>
        </div>
        {!readiness.is_ready ? (
          <p className="mt-2 text-sm text-slate-600">
            {t('legalEntities.missingPrefix', {
              fields: readiness.missing_fields
                .map((field) => formatProfileMissingField(field, t))
                .join(', '),
            })}
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="profile-advisor-number">{t('legalEntities.profile.fields.advisorNumber')}</Label>
          <Input
            id="profile-advisor-number"
            value={form.advisorNumber}
            onChange={(event) =>
              updateForm((current) => ({ ...current, advisorNumber: event.target.value }))
            }
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="profile-client-number">{t('legalEntities.profile.fields.clientNumber')}</Label>
          <Input
            id="profile-client-number"
            value={form.clientNumber}
            onChange={(event) =>
              updateForm((current) => ({ ...current, clientNumber: event.target.value }))
            }
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="profile-account-length">{t('legalEntities.profile.fields.accountLength')}</Label>
          <Input
            id="profile-account-length"
            type="number"
            min={1}
            max={8}
            value={form.accountLength}
            onChange={(event) =>
              updateForm((current) => ({ ...current, accountLength: event.target.value }))
            }
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="profile-debtor-account">{t('legalEntities.profile.fields.defaultDebtorAccount')}</Label>
          <Input
            id="profile-debtor-account"
            value={form.defaultDebtorAccount}
            onChange={(event) =>
              updateForm((current) => ({
                ...current,
                defaultDebtorAccount: event.target.value,
              }))
            }
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="profile-fiscal-year-start">{t('legalEntities.profile.fields.fiscalYearStartMonth')}</Label>
          <Input
            id="profile-fiscal-year-start"
            type="number"
            min={1}
            max={12}
            value={form.fiscalYearStartMonth}
            onChange={(event) =>
              updateForm((current) => ({
                ...current,
                fiscalYearStartMonth: event.target.value,
              }))
            }
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="profile-chart">{t('legalEntities.profile.fields.chart')}</Label>
          <Input
            id="profile-chart"
            value={form.chart}
            onChange={(event) =>
              updateForm((current) => ({ ...current, chart: event.target.value }))
            }
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="profile-code">{t('legalEntities.profile.fields.profileCode')}</Label>
          <Input
            id="profile-code"
            value={form.profileCode}
            onChange={(event) =>
              updateForm((current) => ({ ...current, profileCode: event.target.value }))
            }
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="profile-format-version">{t('legalEntities.profile.fields.formatVersion')}</Label>
          <Input
            id="profile-format-version"
            value={form.profileCode === RZL_PROFILE_CODE ? RZL_FORMAT_VERSION : form.formatVersion}
            disabled={form.profileCode === RZL_PROFILE_CODE}
            onChange={(event) =>
              updateForm((current) => ({ ...current, formatVersion: event.target.value }))
            }
          />
        </div>
      </div>

      {form.profileCode === 'ACP-DATEV-DE-EUR-1' && entity.country_iso === 'DE' ? (
        <div className="flex items-center justify-between rounded-md border border-slate-200 p-4">
          <div>
            <p className="text-sm font-medium text-slate-700">{t('legalEntities.profile.datev.title')}</p>
            <p className="text-sm text-slate-500">
              {t('legalEntities.profile.datev.description')}
            </p>
          </div>
          <Checkbox
            checked={form.isEnabled}
            onCheckedChange={(checked) =>
              updateForm((current) => ({ ...current, isEnabled: checked === true }))
            }
          />
        </div>
      ) : form.profileCode === RZL_PROFILE_CODE && entity.country_iso === 'AT' ? (
        <div className="space-y-4">
          <div className="space-y-3 rounded-md border border-slate-200 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-slate-700">{t('legalEntities.profile.rzl.title')}</p>
                <p className="text-sm text-slate-500">
                  {t('legalEntities.profile.rzl.description')}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  updateForm((current) => ({
                    ...current,
                    rzlSteuercodeVat20: RZL_STEUERCODE_SUGGESTIONS.vat20,
                    rzlSteuercodeVat13: RZL_STEUERCODE_SUGGESTIONS.vat13,
                    rzlSteuercodeVat10: RZL_STEUERCODE_SUGGESTIONS.vat10,
                  }))
                }
              >
                {t('legalEntities.profile.rzl.useSuggested')}
              </Button>
            </div>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="grid gap-2">
                <Label htmlFor="profile-rzl-firm-number">{t('legalEntities.profile.rzl.firmNumber')}</Label>
                <Input
                  id="profile-rzl-firm-number"
                  maxLength={32}
                  value={form.rzlFirmNumber}
                  onChange={(event) =>
                    updateForm((current) => ({ ...current, rzlFirmNumber: event.target.value }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="profile-rzl-steuercode-20">{t('legalEntities.profile.rzl.steuercode20')}</Label>
                <Input
                  id="profile-rzl-steuercode-20"
                  inputMode="numeric"
                  maxLength={4}
                  value={form.rzlSteuercodeVat20}
                  onChange={(event) =>
                    updateForm((current) => ({ ...current, rzlSteuercodeVat20: event.target.value }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="profile-rzl-steuercode-13">{t('legalEntities.profile.rzl.steuercode13')}</Label>
                <Input
                  id="profile-rzl-steuercode-13"
                  inputMode="numeric"
                  maxLength={4}
                  value={form.rzlSteuercodeVat13}
                  onChange={(event) =>
                    updateForm((current) => ({ ...current, rzlSteuercodeVat13: event.target.value }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="profile-rzl-steuercode-10">{t('legalEntities.profile.rzl.steuercode10')}</Label>
                <Input
                  id="profile-rzl-steuercode-10"
                  inputMode="numeric"
                  maxLength={4}
                  value={form.rzlSteuercodeVat10}
                  onChange={(event) =>
                    updateForm((current) => ({ ...current, rzlSteuercodeVat10: event.target.value }))
                  }
                />
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md border border-slate-200 p-4">
            <div>
              <p className="text-sm font-medium text-slate-700">{t('legalEntities.profile.rzl.enabledTitle')}</p>
              <p className="text-sm text-slate-500">
                {profile.serializer_released
                  ? t('legalEntities.profile.rzl.released')
                  : t('legalEntities.profile.rzl.notReleased')}
              </p>
            </div>
            <Checkbox
              checked={form.isEnabled}
              disabled={!profile.serializer_released && !form.isEnabled}
              onCheckedChange={(checked) =>
                updateForm((current) => ({ ...current, isEnabled: checked === true }))
              }
            />
          </div>
          {profile.export_missing_fields.length > 0 ? (
            <p className="text-sm text-amber-700">
              {t('legalEntities.profile.exportMissingLine', {
                fields: profile.export_missing_fields
                  .map((field) => formatRzlExportMissingField(field, t))
                  .join(', '),
              })}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          {t('legalEntities.profile.unsupportedSerializer')}
        </p>
      )}

      <div className="space-y-3">
        <div>
          <h5 className="font-medium">{t('legalEntities.profile.mappings.title')}</h5>
          <p className="text-sm text-slate-500">
            {t('legalEntities.profile.mappings.description')}
          </p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('legalEntities.profile.mappings.category')}</TableHead>
              <TableHead>{t('legalEntities.profile.mappings.tax')}</TableHead>
              <TableHead>{t('legalEntities.profile.mappings.revenueAccount')}</TableHead>
              <TableHead>{t('legalEntities.profile.mappings.treatment')}</TableHead>
              <TableHead>{t('legalEntities.profile.mappings.buKey')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {profile.required_source_categories.map((category) => {
              const rule = findMappingRule(form.mappingRules, category)
              return (
                <TableRow key={`${category.key}:${category.taxMode}:${category.taxRate}`}>
                  <TableCell className="font-medium">{category.label}</TableCell>
                  <TableCell>
                    {category.taxMode === 'MARGIN_SCHEME'
                      ? t('legalEntities.profile.mappings.margin')
                      : formatPercent(Number(category.taxRate))}
                  </TableCell>
                  <TableCell>
                    <Input
                      value={rule?.revenueAccount ?? ''}
                      placeholder={category.suggestedRevenueAccount ?? ''}
                      onChange={(event) =>
                        updateMappingField(category, {
                          revenueAccount: event.target.value,
                        })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Select
                      value={rule?.taxTreatment ?? 'automatic'}
                      onValueChange={(value) =>
                        updateMappingField(category, {
                          taxTreatment: value as AccountingMappingRule['taxTreatment'],
                          buKey: value === 'automatic' ? null : rule?.buKey ?? '',
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="automatic">{t('legalEntities.profile.mappings.automatic')}</SelectItem>
                        <SelectItem value="manual_bu">{t('legalEntities.profile.mappings.manualBu')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      value={rule?.buKey ?? ''}
                      disabled={(rule?.taxTreatment ?? 'automatic') !== 'manual_bu'}
                      onChange={(event) =>
                        updateMappingField(category, { buKey: event.target.value })
                      }
                    />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-slate-500">{t('legalEntities.profile.version', { version })}</p>
    </div>
  )
}

function LegalEntitySellerForm({
  entity,
  onSaved,
}: {
  entity: LegalEntityRecord
  onSaved: (entity: LegalEntityRecord) => void
}) {
  const { t } = useTranslation('settings')
  const updateMutation = useUpdateLegalEntity()
  const [form, setForm] = React.useState<SellerFormState>(() => toFormState(entity))
  const lastSavedRef = React.useRef(JSON.stringify(toFormState(entity)))
  const updateMutationRef = React.useRef(updateMutation)
  const previousEntityIdRef = React.useRef(entity.id)

  React.useEffect(() => {
    updateMutationRef.current = updateMutation
  })

  React.useEffect(() => {
    if (previousEntityIdRef.current === entity.id) {
      return
    }

    const nextForm = toFormState(entity)
    setForm(nextForm)
    lastSavedRef.current = JSON.stringify(nextForm)
    previousEntityIdRef.current = entity.id
  }, [entity])

  const saveSellerSettings = React.useCallback(
    async (snapshot: SellerFormState, signal: AbortSignal) => {
      const serialized = JSON.stringify(snapshot)
      if (serialized === lastSavedRef.current) {
        return
      }

      const updated = await updateMutationRef.current.mutateAsync(
        buildUpdatePayload(entity.id, snapshot),
      )
      if (signal.aborted) {
        return
      }

      lastSavedRef.current = serialized
      onSaved(updated)
    },
    [entity.id, onSaved],
  )

  const { saveStatus, triggerAutoSave } = useDebouncedAutoSave({
    save: saveSellerSettings,
    shouldSave: (snapshot) => snapshot.name.trim().length > 0,
  })

  const updateField = <K extends keyof SellerFormState>(key: K, value: SellerFormState[K]) => {
    setForm((current) => {
      const next = { ...current, [key]: value }
      triggerAutoSave(next)
      return next
    })
  }

  const readiness = entity.seller_readiness

  return (
    <div className="space-y-6 rounded-lg border bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="font-medium">{entity.name}</h4>
          <p className="text-sm text-slate-500">
            {t('legalEntities.seller.description', { country: entity.country_iso })}
          </p>
        </div>
        <DocumentSaveIndicator status={saveStatus} />
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center gap-3">
          <StatusBadge status={readiness.is_ready ? 'ACTIVE' : 'INACTIVE'} />
          <span className="text-sm font-medium text-slate-700">
            {readiness.is_ready ? t('legalEntities.seller.ready') : t('legalEntities.seller.incomplete')}
          </span>
        </div>
        {!readiness.is_ready ? (
          <p className="mt-2 text-sm text-slate-600">
            {t('legalEntities.missingPrefix', {
              fields: readiness.missing_fields
                .map((field) => formatMissingField(field, entity.country_iso, t))
                .join(', '),
            })}
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-2 md:col-span-2">
          <Label htmlFor="seller-name">{t('legalEntities.seller.fields.legalName')}</Label>
          <Input
            id="seller-name"
            value={form.name}
            onChange={(event) => updateField('name', event.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="seller-street">{t('legalEntities.seller.fields.street')}</Label>
          <Input
            id="seller-street"
            value={form.addressStreet}
            onChange={(event) => updateField('addressStreet', event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="seller-line2">{t('legalEntities.seller.fields.line2')}</Label>
          <Input
            id="seller-line2"
            value={form.addressLine2}
            onChange={(event) => updateField('addressLine2', event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="seller-zip">{t('legalEntities.seller.fields.zip')}</Label>
          <Input
            id="seller-zip"
            value={form.addressZip}
            onChange={(event) => updateField('addressZip', event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="seller-city">{t('legalEntities.seller.fields.city')}</Label>
          <Input
            id="seller-city"
            value={form.addressCity}
            onChange={(event) => updateField('addressCity', event.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="seller-tax-number">
            {entity.country_iso === 'DE'
              ? t('legalEntities.seller.fields.taxNumberDe')
              : t('legalEntities.seller.fields.taxNumber')}
          </Label>
          <Input
            id="seller-tax-number"
            value={form.taxNumber}
            onChange={(event) => updateField('taxNumber', event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="seller-vat-id">
            {entity.country_iso === 'AT'
              ? t('legalEntities.seller.fields.vatIdAt')
              : t('legalEntities.seller.fields.vatIdDe')}
          </Label>
          <Input
            id="seller-vat-id"
            value={form.vatId}
            onChange={(event) => updateField('vatId', event.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="seller-iban">{t('legalEntities.seller.fields.iban')}</Label>
          <Input
            id="seller-iban"
            value={form.iban}
            onChange={(event) => updateField('iban', event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="seller-bic">{t('legalEntities.seller.fields.bic')}</Label>
          <Input
            id="seller-bic"
            value={form.bic}
            onChange={(event) => updateField('bic', event.target.value)}
          />
        </div>
        <div className="grid gap-2 md:col-span-2">
          <Label htmlFor="seller-bank-name">{t('legalEntities.seller.fields.bankName')}</Label>
          <Input
            id="seller-bank-name"
            value={form.bankName}
            onChange={(event) => updateField('bankName', event.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="seller-email">{t('legalEntities.seller.fields.email')}</Label>
          <Input
            id="seller-email"
            type="email"
            value={form.email}
            onChange={(event) => updateField('email', event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="seller-phone">{t('legalEntities.seller.fields.phone')}</Label>
          <Input
            id="seller-phone"
            value={form.phone}
            onChange={(event) => updateField('phone', event.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="seller-registration-number">{t('legalEntities.seller.fields.registrationNumber')}</Label>
          <Input
            id="seller-registration-number"
            value={form.registrationNumber}
            onChange={(event) => updateField('registrationNumber', event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="seller-registration-court">{t('legalEntities.seller.fields.registrationCourt')}</Label>
          <Input
            id="seller-registration-court"
            value={form.registrationCourt}
            onChange={(event) => updateField('registrationCourt', event.target.value)}
          />
        </div>

        <div className="grid gap-2 md:col-span-2">
          <Label htmlFor="seller-representatives">{t('legalEntities.seller.fields.representatives')}</Label>
          <textarea
            id="seller-representatives"
            className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={form.representatives}
            onChange={(event) => updateField('representatives', event.target.value)}
          />
        </div>

        <div className="grid gap-2 md:col-span-2">
          <Label>{t('legalEntities.seller.fields.rksvMode')}</Label>
          <Select
            value={form.rksvMode}
            onValueChange={(value) =>
              updateField('rksvMode', value as LegalEntityRecord['rksv_mode'])
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="OFF">{t('legalEntities.seller.rksv.off')}</SelectItem>
              <SelectItem value="UNKNOWN">{t('legalEntities.seller.rksv.unknown')}</SelectItem>
              <SelectItem value="REQUIRED_EXTERNAL_KASSE">{t('legalEntities.seller.rksv.externalKasse')}</SelectItem>
              <SelectItem value="REQUIRED_ACP_RKSV">{t('legalEntities.seller.rksv.acpRksv')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="seller-payment-days">{t('legalEntities.seller.fields.paymentTermsDays')}</Label>
          <Input
            id="seller-payment-days"
            type="number"
            min={0}
            max={365}
            value={form.paymentTermsDays}
            onChange={(event) => updateField('paymentTermsDays', event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="seller-payment-text">{t('legalEntities.seller.fields.paymentTermsText')}</Label>
          <textarea
            id="seller-payment-text"
            className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={form.paymentTermsText}
            onChange={(event) => updateField('paymentTermsText', event.target.value)}
          />
        </div>
      </div>
    </div>
  )
}

export function LegalEntitiesSettingsTab() {
  const { t } = useTranslation('settings')
  const { data: entities, isLoading } = useLegalEntities()
  const createMutation = useCreateLegalEntity()
  const updateMutation = useUpdateLegalEntity()

  const [name, setName] = React.useState('')
  const [countryIso, setCountryIso] = React.useState<'AT' | 'DE'>('AT')
  const [selectedEntityId, setSelectedEntityId] = React.useState<string | null>(null)
  const [selectedEntity, setSelectedEntity] = React.useState<LegalEntityRecord | null>(null)

  React.useEffect(() => {
    if (!selectedEntityId && entities?.length) {
      setSelectedEntityId(entities[0].id)
      setSelectedEntity(entities[0])
    }
  }, [entities, selectedEntityId])

  React.useEffect(() => {
    const next = entities?.find((entity) => entity.id === selectedEntityId) ?? null
    if (next) {
      setSelectedEntity(next)
    }
  }, [entities, selectedEntityId])

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return

    try {
      const created = await createMutation.mutateAsync({ name: name.trim(), countryIso })
      toast.success(t('legalEntities.toast.created'))
      setName('')
      setSelectedEntityId(created.id)
      setSelectedEntity(created)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('legalEntities.toast.createFailed'))
    }
  }

  const toggleActive = async (id: string, isActive: boolean) => {
    try {
      const updated = await updateMutation.mutateAsync({ id, isActive: !isActive })
      if (selectedEntityId === id) {
        setSelectedEntity(updated)
      }
      toast.success(
        isActive ? t('legalEntities.toast.deactivated') : t('legalEntities.toast.reactivated'),
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('legalEntities.toast.updateFailed'))
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium">{t('legalEntities.title')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('legalEntities.description')}
        </p>
      </div>

      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <form onSubmit={handleCreate} className="grid gap-4 md:grid-cols-[1fr_160px_auto] md:items-end">
          <div className="grid gap-2">
            <Label htmlFor="legal-entity-name">{t('legalEntities.create.nameLabel')}</Label>
            <Input
              id="legal-entity-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('legalEntities.create.namePlaceholder')}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="legal-entity-country">{t('legalEntities.create.countryLabel')}</Label>
            <Select value={countryIso} onValueChange={(value) => setCountryIso(value as 'AT' | 'DE')}>
              <SelectTrigger id="legal-entity-country">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AT">{t('legalEntities.create.countryAt')}</SelectItem>
                <SelectItem value="DE">{t('legalEntities.create.countryDe')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={createMutation.isPending || !name.trim()}>
            {t('legalEntities.create.submit')}
          </Button>
        </form>
      </div>

      <div className="rounded-lg border bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('legalEntities.table.name')}</TableHead>
              <TableHead>{t('legalEntities.table.country')}</TableHead>
              <TableHead>{t('legalEntities.table.readiness')}</TableHead>
              <TableHead>{t('legalEntities.table.status')}</TableHead>
              <TableHead className="text-right">{t('legalEntities.table.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(entities ?? []).map((entity) => (
              <TableRow
                key={entity.id}
                data-state={entity.id === selectedEntityId ? 'selected' : undefined}
                className={entity.id === selectedEntityId ? 'bg-slate-50' : undefined}
                onClick={() => setSelectedEntityId(entity.id)}
              >
                <TableCell className="font-medium">{entity.name}</TableCell>
                <TableCell>{entity.country_iso}</TableCell>
                <TableCell>
                  <StatusBadge status={entity.seller_readiness.is_ready ? 'ACTIVE' : 'INACTIVE'} />
                </TableCell>
                <TableCell>
                  <StatusBadge status={entity.is_active ? 'ACTIVE' : 'INACTIVE'} />
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={updateMutation.isPending}
                    onClick={(event) => {
                      event.stopPropagation()
                      void toggleActive(entity.id, entity.is_active)
                    }}
                  >
                    {entity.is_active
                      ? t('legalEntities.table.deactivate')
                      : t('legalEntities.table.reactivate')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {selectedEntity ? (
        <>
          <LegalEntitySellerForm
            entity={selectedEntity}
            onSaved={(updated) => setSelectedEntity(updated)}
          />
          <LegalEntityAccountingProfileForm entity={selectedEntity} />
          <DocumentBrandingSettings entity={selectedEntity} />
        </>
      ) : null}
    </div>
  )
}
