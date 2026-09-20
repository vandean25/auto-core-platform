import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTenantAwarePrisma } from './tenant-test-utils.js';
import { FIXED_SOURCE_CATEGORY_KEYS } from '../src/finance/accounting-profile/accounting-profile.types.js';

export async function seedReadySellerAndAccountingProfile(
  prisma: PrismaService,
  tenantId: string,
  options: {
    countryIso?: 'AT' | 'DE';
    taxRate?: string;
    includeVehicleMargin?: boolean;
  } = {},
) {
  const countryIso = options.countryIso ?? 'AT';
  const taxRate = options.taxRate ?? '20.00';
  const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
  const entity = await tenantPrisma.legalEntity.findFirstOrThrow({
    where: { tenant_id: tenantId },
  });

  await tenantPrisma.legalEntity.update({
    where: { id: entity.id },
    data: {
      address_street: 'Hauptstraße 1',
      address_zip: '1010',
      address_city: 'Wien',
      vat_id: countryIso === 'AT' ? 'ATU12345678' : null,
      tax_number: countryIso === 'DE' ? '27/010/12345' : null,
      payment_terms_days: 14,
      payment_terms_text: 'Zahlbar innerhalb von 14 Tagen.',
    },
  });

  const profile = await tenantPrisma.legalEntityAccountingProfile.upsert({
    where: {
      tenant_id_legal_entity_id: {
        tenant_id: tenantId,
        legal_entity_id: entity.id,
      },
    },
    update: {},
    create: {
      tenant_id: tenantId,
      legal_entity_id: entity.id,
      profile_code: 'ACP-DATEV-DE-EUR-1',
      format_version: 'EXTF-700-Buchungsstapel-13',
      advisor_number: '12345',
      client_number: '1',
      account_length: 4,
      default_debtor_account: '1000',
      mapping_rules: [
        {
          sourceCategoryKey: FIXED_SOURCE_CATEGORY_KEYS.MANUAL_LINE,
          sourceCategoryLabel: 'Manual invoice lines',
          taxMode: 'STANDARD',
          taxRate,
          revenueAccount: '8400',
          taxTreatment: 'automatic',
        },
        {
          sourceCategoryKey: FIXED_SOURCE_CATEGORY_KEYS.LABOR,
          sourceCategoryLabel: 'Labor / workshop services',
          taxMode: 'STANDARD',
          taxRate,
          revenueAccount: '8500',
          taxTreatment: 'automatic',
        },
        ...(options.includeVehicleMargin
          ? [
              {
                sourceCategoryKey: FIXED_SOURCE_CATEGORY_KEYS.VEHICLE_MARGIN,
                sourceCategoryLabel: 'Vehicle margin scheme',
                taxMode: 'MARGIN_SCHEME',
                taxRate: '0.00',
                revenueAccount: '8600',
                taxTreatment: 'automatic',
              },
            ]
          : []),
      ],
    },
  });

  return { entity, profile };
}

export async function seedInvoiceReadyCustomer(
  prisma: PrismaService,
  tenantId: string,
) {
  const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
  return tenantPrisma.customer.create({
    data: {
      first_name: 'Max',
      last_name: 'Mustermann',
      email: 'max@example.com',
      address_street: 'Kundenstraße 2',
      address_zip: '1020',
      address_city: 'Wien',
      address_country: 'AT',
      type: 'PRIVATE',
    },
  });
}
