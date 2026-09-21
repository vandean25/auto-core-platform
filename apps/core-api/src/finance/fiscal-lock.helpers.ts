import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export async function lockFinanceSettingsAndAssertOpen(
  tx: Prisma.TransactionClient,
  tenantId: string,
  date: Date,
): Promise<void> {
  await tx.$queryRaw`
    SELECT id
    FROM finance_settings
    WHERE tenant_id = ${tenantId}
    FOR UPDATE
  `;

  const settings = await tx.financeSettings.findFirst({
    where: { tenant_id: tenantId },
    select: { lock_date: true },
  });

  if (settings?.lock_date && date <= settings.lock_date) {
    throw new UnprocessableEntityException({
      code: 'FISCAL_PERIOD_LOCKED',
      message: `Transaction date ${date.toISOString()} is in a locked fiscal period.`,
      lockDate: settings.lock_date.toISOString(),
    });
  }
}
