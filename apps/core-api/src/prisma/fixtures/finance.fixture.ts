import type { SeedPrismaClient, FinanceContext } from './types';

export async function seedFinance(
  prisma: SeedPrismaClient,
  tenantId: string,
): Promise<FinanceContext> {
  console.log('Seeding Finance Module settings...');

  // Revenue Groups (Austrian standards)
  const revenueGroups = await Promise.all([
    prisma.revenueGroup.upsert({
      where: {
        tenant_id_name: { tenant_id: tenantId, name: 'Parts / Goods 20%' },
      },
      update: {},
      create: {
        tenant_id: tenantId,
        name: 'Parts / Goods 20%',
        tax_rate: 20.0,
        account_number: '4000',
        is_default: true,
      },
    }),
    prisma.revenueGroup.upsert({
      where: {
        tenant_id_name: { tenant_id: tenantId, name: 'Services / Labor 20%' },
      },
      update: {},
      create: {
        tenant_id: tenantId,
        name: 'Services / Labor 20%',
        tax_rate: 20.0,
        account_number: '4001',
        is_default: false,
      },
    }),
    prisma.revenueGroup.upsert({
      where: {
        tenant_id_name: { tenant_id: tenantId, name: 'Tax Free / Margin' },
      },
      update: {},
      create: {
        tenant_id: tenantId,
        name: 'Tax Free / Margin',
        tax_rate: 0.0,
        account_number: '4099',
        is_default: false,
      },
    }),
  ]);

  const currentYear = new Date().getFullYear();
  const financeSettings = await prisma.financeSettings.upsert({
    where: { tenant_id: tenantId },
    update: {},
    create: {
      tenant_id: tenantId,
      fiscal_year_start_month: 1,
      lock_date: null,
      next_invoice_number: 1001,
      invoice_prefix: `RE-${currentYear}-`,
      next_workshop_order_number: 1,
      workshop_order_prefix: `WO-${currentYear}-`,
      next_sales_order_number: 1,
      sales_order_prefix: `SO-${currentYear}-`,
    },
  });

  return {
    revenueGroups,
    defaultRevenueGroup: revenueGroups[0],
    financeSettings,
  };
}
