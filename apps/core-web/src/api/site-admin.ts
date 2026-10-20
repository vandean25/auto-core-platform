import { fetchJsonWithAuth } from "./api-error";
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { siteKeys } from './sites'

export type LegalEntitySellerReadiness = {
  is_ready: boolean
  missing_fields: string[]
}

export type LegalEntityRecord = {
  id: string
  tenant_id: string
  name: string
  country_iso: 'AT' | 'DE'
  is_active: boolean
  address_street: string | null
  address_line2: string | null
  address_zip: string | null
  address_city: string | null
  tax_number: string | null
  vat_id: string | null
  iban: string | null
  bic: string | null
  bank_name: string | null
  email: string | null
  phone: string | null
  registration_number: string | null
  registration_court: string | null
  representatives: string | null
  payment_terms_days: number | null
  payment_terms_text: string | null
  seller_readiness: LegalEntitySellerReadiness
  rksv_mode: 'OFF' | 'UNKNOWN' | 'REQUIRED_EXTERNAL_KASSE' | 'REQUIRED_ACP_RKSV'
}

export type UpdateLegalEntityPayload = {
  id: string
  name?: string
  isActive?: boolean
  addressStreet?: string | null
  addressLine2?: string | null
  addressZip?: string | null
  addressCity?: string | null
  taxNumber?: string | null
  vatId?: string | null
  iban?: string | null
  bic?: string | null
  bankName?: string | null
  email?: string | null
  phone?: string | null
  registrationNumber?: string | null
  registrationCourt?: string | null
  representatives?: string | null
  paymentTermsDays?: number | null
  paymentTermsText?: string | null
  rksvMode?: LegalEntityRecord['rksv_mode']
}

export type AdminSiteRecord = {
  id: string
  tenant_id: string
  legal_entity_id: string
  code: string
  name: string
  is_active: boolean
  legal_entity?: {
    id: string
    name: string
    country_iso: string
  }
  _count?: {
    memberships: number
    bays: number
    storageLocations: number
  }
}

export type SiteMembershipRecord = {
  id: string
  tenant_id: string
  user_id: string
  site_id: string
  is_active: boolean
  user: {
    id: string
    email: string
    firstName: string | null
    lastName: string | null
  }
  tenantMember: {
    role: string
    is_active: boolean
  }
}

export type AccountingMappingRule = {
  sourceCategoryKey: string
  sourceCategoryLabel: string
  taxMode: 'STANDARD' | 'MARGIN_SCHEME'
  taxRate: string
  revenueAccount: string
  taxTreatment: 'automatic' | 'manual_bu'
  buKey?: string | null
}

export type SourceCategoryDefinition = {
  key: string
  label: string
  taxMode: 'STANDARD' | 'MARGIN_SCHEME'
  taxRate: string
  suggestedRevenueAccount: string | null
}

export type AccountingProfileReadiness = {
  is_ready: boolean
  missing_fields: string[]
  unmapped_categories: string[]
}

export type AccountingSerializerParams = {
  rzl?: {
    firmNumber?: string | null
    costCenterLength?: number | null
    steuercodes?: {
      vat20?: string | null
      vat13?: string | null
      vat10?: string | null
    }
  }
}

export type AccountingProfileRecord = {
  id: string
  tenant_id: string
  legal_entity_id: string
  version: number
  is_enabled: boolean
  profile_code: string | null
  format_version: string | null
  chart: string | null
  account_length: number | null
  advisor_number: string | null
  client_number: string | null
  fiscal_year_start_month: number | null
  default_debtor_account: string | null
  serializer_params: AccountingSerializerParams
  serializer_released: boolean
  export_missing_fields: string[]
  mapping_rules: AccountingMappingRule[]
  required_source_categories: SourceCategoryDefinition[]
  mapping_readiness: AccountingProfileReadiness
}

export type UpdateAccountingProfilePayload = {
  legalEntityId: string
  expectedVersion: number
  profileCode?: string | null
  formatVersion?: string | null
  chart?: string | null
  accountLength?: number | null
  advisorNumber?: string | null
  clientNumber?: string | null
  fiscalYearStartMonth?: number | null
  defaultDebtorAccount?: string | null
  mappingRules?: AccountingMappingRule[]
  serializerParams?: AccountingSerializerParams
  isEnabled?: boolean
}

export const siteAdminKeys = {
  all: ['site-admin'] as const,
  legalEntities: () => [...siteAdminKeys.all, 'legal-entities'] as const,
  legalEntity: (id: string) => [...siteAdminKeys.all, 'legal-entity', id] as const,
  accountingProfile: (legalEntityId: string) =>
    [...siteAdminKeys.all, 'accounting-profile', legalEntityId] as const,
  sites: (includeInactive = true) =>
    [...siteAdminKeys.all, 'sites', { includeInactive }] as const,
  memberships: (siteId: string) =>
    [...siteAdminKeys.all, 'memberships', siteId] as const,
}

export function useLegalEntities() {
  return useQuery<LegalEntityRecord[]>({
    queryKey: siteAdminKeys.legalEntities(),
    queryFn: async () => {
      return fetchJsonWithAuth(
        "/api/legal-entities",
        "Failed to load legal entities",
      );
    },
  });
}

export function useLegalEntity(id: string | null) {
  return useQuery<LegalEntityRecord>({
    queryKey: siteAdminKeys.legalEntity(id ?? ""),
    enabled: Boolean(id),
    queryFn: async () => {
      return fetchJsonWithAuth(
        `/api/legal-entities/${id}`,
        "Failed to load legal entity",
      );
    },
  });
}

export function useCreateLegalEntity() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: { name: string; countryIso: "AT" | "DE" }) => {
      return fetchJsonWithAuth<LegalEntityRecord>(
        "/api/legal-entities",
        "Failed to create legal entity",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: siteAdminKeys.legalEntities() })
    },
  });
}

export function useUpdateLegalEntity() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: UpdateLegalEntityPayload) => {
      const { id, ...body } = payload
      return fetchJsonWithAuth<LegalEntityRecord>(
        `/api/legal-entities/${id}`,
        "Failed to update legal entity",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
    },
    onSuccess: (entity) => {
      queryClient.setQueryData(siteAdminKeys.legalEntity(entity.id), entity)
      queryClient.invalidateQueries({ queryKey: siteAdminKeys.legalEntities() })
      queryClient.invalidateQueries({ queryKey: siteAdminKeys.all })
    },
  });
}

export function useAccountingProfile(legalEntityId: string | null) {
  return useQuery<AccountingProfileRecord>({
    queryKey: siteAdminKeys.accountingProfile(legalEntityId ?? ""),
    enabled: Boolean(legalEntityId),
    queryFn: async () => {
      return fetchJsonWithAuth(
        `/api/legal-entities/${legalEntityId}/accounting-profile`,
        "Failed to load accounting profile",
      );
    },
  });
}

export function useUpdateAccountingProfile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: UpdateAccountingProfilePayload) => {
      const { legalEntityId, ...body } = payload
      return fetchJsonWithAuth<AccountingProfileRecord>(
        `/api/legal-entities/${legalEntityId}/accounting-profile`,
        "Failed to update accounting profile",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(
        siteAdminKeys.accountingProfile(profile.legal_entity_id),
        profile,
      )
    },
  });
}

export function useAdminSites(includeInactive = true) {
  return useQuery<AdminSiteRecord[]>({
    queryKey: siteAdminKeys.sites(includeInactive),
    queryFn: async () => {
      return fetchJsonWithAuth(
        `/api/sites?includeInactive=${includeInactive ? "true" : "false"}`,
        "Failed to load sites",
      );
    },
  });
}

export function useSiteMemberships(siteId: string | null) {
  return useQuery<SiteMembershipRecord[]>({
    queryKey: siteAdminKeys.memberships(siteId ?? ""),
    enabled: !!siteId,
    queryFn: async () => {
      return fetchJsonWithAuth(
        `/api/sites/${siteId}/memberships`,
        "Failed to load site memberships",
      );
    },
  });
}

export function useAddSiteMembership() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: { siteId: string; userId: string }) => {
      return fetchJsonWithAuth(
        `/api/sites/${payload.siteId}/memberships`,
        "Failed to add site membership",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: payload.userId }),
        },
      );
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: siteAdminKeys.memberships(variables.siteId),
      })
      queryClient.invalidateQueries({ queryKey: siteAdminKeys.sites(true) })
      queryClient.invalidateQueries({ queryKey: siteKeys.me() })
    },
  });
}

export function useRemoveSiteMembership() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: { siteId: string; userId: string }) => {
      return fetchJsonWithAuth(
        `/api/sites/${payload.siteId}/memberships/${payload.userId}`,
        "Failed to remove site membership",
        { method: "DELETE" },
      );
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: siteAdminKeys.memberships(variables.siteId),
      })
      queryClient.invalidateQueries({ queryKey: siteAdminKeys.sites(true) })
      queryClient.invalidateQueries({ queryKey: siteKeys.me() })
    },
  });
}
