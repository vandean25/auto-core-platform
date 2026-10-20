import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import {
  FIXED_SOURCE_CATEGORY_KEYS,
  revenueGroupSourceCategoryKey,
} from '../src/finance/accounting-profile/accounting-profile.types.js';
import { createTenantAwarePrisma } from './tenant-test-utils.js';

export function buildDeMappingRules(
  taxRate = '20.00',
  revenueGroups: { id: number; name: string; tax_rate: { toString(): string } }[] = [],
) {
  const revenueGroupRules = revenueGroups.map((group) => ({
    sourceCategoryKey: revenueGroupSourceCategoryKey(group.id),
    sourceCategoryLabel: group.name,
    taxMode: 'STANDARD' as const,
    taxRate: Number.parseFloat(group.tax_rate.toString()).toFixed(2),
    revenueAccount: '8400',
    taxTreatment: 'automatic' as const,
  }));

  return [
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
    ...revenueGroupRules,
  ];
}

export async function seedDeAccountingExportProfile(
  prisma: PrismaService,
  tenantId: string,
  legalEntityId: string,
  options: { isEnabled?: boolean } = {},
) {
  const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
  const revenueGroups = await tenantPrisma.revenueGroup.findMany({
    where: { tenant_id: tenantId },
    orderBy: { id: 'asc' },
  });
  const mappingRules = buildDeMappingRules('20.00', revenueGroups);

  return tenantPrisma.legalEntityAccountingProfile.upsert({
    where: {
      tenant_id_legal_entity_id: {
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
      },
    },
    update: {
      mapping_rules: mappingRules,
      advisor_number: '12345',
      client_number: '1',
      account_length: 4,
      fiscal_year_start_month: 1,
      default_debtor_account: '1000',
      profile_code: 'ACP-DATEV-DE-EUR-1',
      format_version: 'EXTF-700-Buchungsstapel-13',
      chart: 'SKR03',
      is_enabled: options.isEnabled ?? false,
    },
    create: {
      tenant_id: tenantId,
      legal_entity_id: legalEntityId,
      profile_code: 'ACP-DATEV-DE-EUR-1',
      format_version: 'EXTF-700-Buchungsstapel-13',
      chart: 'SKR03',
      advisor_number: '12345',
      client_number: '1',
      account_length: 4,
      fiscal_year_start_month: 1,
      default_debtor_account: '1000',
      mapping_rules: mappingRules,
      is_enabled: options.isEnabled ?? false,
    },
  });
}

export async function closeFinancePeriod(
  prisma: PrismaService,
  tenantId: string,
  lockDate: string,
) {
  const tenantPrisma = createTenantAwarePrisma(prisma, tenantId);
  const currentYear = new Date().getFullYear();
  return tenantPrisma.financeSettings.upsert({
    where: { tenant_id: tenantId },
    update: { lock_date: new Date(`${lockDate}T23:59:59.999Z`) },
    create: {
      tenant_id: tenantId,
      fiscal_year_start_month: 1,
      lock_date: new Date(`${lockDate}T23:59:59.999Z`),
      next_invoice_number: 1001,
      invoice_prefix: `RE-${currentYear}-`,
      next_sales_order_number: 1001,
      sales_order_prefix: `SO-${currentYear}-`,
      next_workshop_order_number: 1,
      workshop_order_prefix: `WO-${currentYear}-`,
    },
  });
}

export async function createAccountingExportInvoice(
  context: {
    app: INestApplication;
    tenantPrisma: PrismaService;
    authToken: string;
    customerId: string;
    catalogItemId: string;
  },
  input: {
    quantity: number;
    unitPrice: number;
    invoiceDate: string;
    siteId: string;
    legalEntityId: string;
  },
) {
  const { app, tenantPrisma, authToken, customerId, catalogItemId } = context;
  const { quantity, unitPrice, invoiceDate, siteId, legalEntityId } = input;
  const orderRes = await request(app.getHttpServer())
    .post('/api/sales-orders')
    .set('Authorization', `Bearer ${authToken}`)
    .send({
      customer_id: customerId,
      items: [
        {
          catalog_item_id: catalogItemId,
          description: 'Brake Disc',
          quantity,
          unit_price: unitPrice,
          tax_rate: 20,
        },
      ],
    })
    .expect(201);

  await tenantPrisma.salesOrder.updateMany({
    where: { id: orderRes.body.id },
    data: { status: 'CONFIRMED' },
  });

  const invoiceRes = await request(app.getHttpServer())
    .post(`/api/sales-orders/${orderRes.body.id}/create-invoice`)
    .set('Authorization', `Bearer ${authToken}`)
    .expect(201);

  await tenantPrisma.invoice.updateMany({
    where: { id: invoiceRes.body.id },
    data: {
      date: new Date(`${invoiceDate}T12:00:00.000Z`),
      site_id: siteId,
      legal_entity_id: legalEntityId,
    },
  });

  const finalized = await request(app.getHttpServer())
    .put(`/api/sales/invoices/${invoiceRes.body.id}/finalize`)
    .set('Authorization', `Bearer ${authToken}`);

  if (finalized.status !== 200) {
    throw new Error(
      `Invoice finalize failed (${finalized.status}): ${JSON.stringify(finalized.body)}`,
    );
  }

  return finalized.body as { id: string };
}

export async function openAccountingExportFinancePeriod(
  tenantPrisma: PrismaService,
  tenantId: string,
) {
  const currentYear = new Date().getFullYear();
  await tenantPrisma.financeSettings.upsert({
    where: { tenant_id: tenantId },
    update: { lock_date: null },
    create: {
      tenant_id: tenantId,
      fiscal_year_start_month: 1,
      lock_date: null,
      next_invoice_number: 1001,
      invoice_prefix: `RE-${currentYear}-`,
      next_sales_order_number: 1001,
      sales_order_prefix: `SO-${currentYear}-`,
      next_workshop_order_number: 1,
      workshop_order_prefix: `WO-${currentYear}-`,
    },
  });
}
