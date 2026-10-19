import type { Prisma } from '@prisma/client';
import type { UpdateSiteFiscalRegisterDto } from './dto/site.dto.js';

export function isFiscalRegisterBindingComplete(
  binding: UpdateSiteFiscalRegisterDto,
): boolean {
  return Boolean(
    binding.providerCashRegisterId &&
    binding.providerScuId &&
    binding.env &&
    binding.providerState,
  );
}

export function fiscalRegisterUpsertArgs(
  tenantId: string,
  siteId: string,
  legalEntityId: string,
  binding: UpdateSiteFiscalRegisterDto,
): Prisma.FiscalRegisterUpsertArgs {
  const shared = {
    env: binding.env!,
    provider_cash_register_id: binding.providerCashRegisterId!,
    provider_scu_id: binding.providerScuId!,
    provider_state: binding.providerState!,
    credentials_secret_ref: binding.credentialsSecretRef ?? null,
  };
  return {
    where: { tenant_id_site_id: { tenant_id: tenantId, site_id: siteId } },
    create: {
      tenant_id: tenantId,
      legal_entity_id: legalEntityId,
      site_id: siteId,
      provider: 'FISKALY_SIGN_AT_1_2_6',
      ...shared,
    },
    update: shared,
  };
}
