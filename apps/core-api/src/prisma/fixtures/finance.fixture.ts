import type { SeedPrismaClient, FinanceContext } from './types.js';
import { DEMO_WORKSHOP_REVENUE_GROUP_SPECS } from './demo-workshop-revenue-groups.fixture.js';

export async function seedFinance(
  prisma: SeedPrismaClient,
  tenantId: string,
): Promise<FinanceContext> {
  console.log('Seeding Finance Module settings...');

  const revenueGroups = await Promise.all(
    DEMO_WORKSHOP_REVENUE_GROUP_SPECS.map((spec) =>
      prisma.revenueGroup.upsert({
        where: {
          tenant_id_name: { tenant_id: tenantId, name: spec.name },
        },
        update: {},
        create: {
          tenant_id: tenantId,
          name: spec.name,
          tax_rate: spec.tax_rate,
          account_number: spec.account_number,
          is_default: spec.is_default,
        },
      }),
    ),
  );

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
