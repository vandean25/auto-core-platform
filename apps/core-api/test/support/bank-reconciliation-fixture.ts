import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../../src/prisma/prisma.service.js';

export async function bankFixture(prisma: PrismaService, tenantId: string) {
  const site = await prisma.site.findFirstOrThrow({
    where: { tenant_id: tenantId, code: 'MAIN' },
  });
  const ownership = {
    tenant_id: tenantId,
    legal_entity_id: site.legal_entity_id,
  };
  const customer = await prisma.customer.create({
    data: { tenant_id: tenantId, first_name: 'Max', last_name: 'Muster' },
  });
  const date = new Date();
  const receivingIban = 'AT611904300234573201';

  return {
    ownership,
    site,
    date,
    receivingIban,
    enable: (enabled: boolean) =>
      prisma.financeSettings.upsert({
        where: { tenant_id: tenantId },
        update: { bank_reconciliation_enabled: enabled },
        create: {
          tenant_id: tenantId,
          workshop_order_prefix: 'WO-',
          bank_reconciliation_enabled: enabled,
        },
      }),
    invoice: (number: string, gross = 120, id?: string) =>
      prisma.invoice.create({
        data: {
          ...ownership,
          site_id: site.id,
          customer_id: customer.id,
          id,
          invoice_number: number,
          status: 'ISSUED',
          date,
          due_date: date,
          total_gross: gross,
          total_net: 100,
          total_tax: 20,
        },
      }),
    transfer: async (reference: string, amount = 120) => {
      const statement = await prisma.bankStatementImport.create({
        data: {
          ...ownership,
          receiving_iban: receivingIban,
          file_name: 'fixture.xml',
          file_sha256: randomUUID(),
        },
      });
      return prisma.bankTransaction.create({
        data: {
          ...ownership,
          import_id: statement.id,
          receiving_iban: receivingIban,
          booking_date: date,
          amount,
          currency: 'EUR',
          is_credit: true,
          bank_ref: randomUUID(),
          reference_text: reference,
          remitter_name: 'Max Muster',
        },
      });
    },
  };
}
