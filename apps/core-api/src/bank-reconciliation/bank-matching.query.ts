import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  CreditNoteStatus,
  InvoiceStatus,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import type { BankTransaction } from '@prisma/client';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import { bankOutstanding } from './bank-outstanding.js';

type Access = { tenantId: string; userId: string; siteIds: string[] };
type Database = Prisma.TransactionClient;

const SETTLED = [PaymentStatus.SETTLED, PaymentStatus.SETTLED_EXTERNAL];
const PENDING = [PaymentStatus.PENDING, PaymentStatus.UNKNOWN];

export async function loadBankAccess(
  db: Database,
  context: TenantContextService,
  tenantId: string,
): Promise<Access> {
  const auth = context.getAuthenticatedUser();
  const member = await db.tenantMember.findFirst({
    where: {
      tenant_id: tenantId,
      is_active: true,
      role: { in: ['OWNER', 'ADMIN'] },
      user: { firebaseUid: auth?.userId ?? '' },
    },
    select: { user_id: true },
  });
  if (!member) throw new ForbiddenException('Tenant admin access is required.');

  const sites = await db.siteMembership.findMany({
    where: {
      tenant_id: tenantId,
      user_id: member.user_id,
      is_active: true,
      tenantMember: { tenant_id: tenantId, is_active: true },
      site: { tenant_id: tenantId, is_active: true },
    },
    select: { site_id: true },
  });
  return {
    tenantId,
    userId: member.user_id,
    siteIds: sites.map(({ site_id }) => site_id),
  };
}

export async function loadBankTransaction(
  db: Database,
  tenantId: string,
  id: string,
) {
  const transfer = await db.bankTransaction.findFirst({
    where: { tenant_id: tenantId, id },
  });
  if (!transfer) throw new NotFoundException();
  return transfer;
}

export function loadBankInvoices(
  db: Database,
  scope: { access: Access; transfer: BankTransaction },
  ids?: string[],
) {
  const { access, transfer } = scope;
  const ownership = {
    tenant_id: access.tenantId,
    legal_entity_id: transfer.legal_entity_id,
    site_id: { in: access.siteIds },
  };
  return db.invoice.findMany({
    where: {
      ...ownership,
      currency: 'EUR',
      ...(ids
        ? { id: { in: ids } }
        : { status: InvoiceStatus.ISSUED, total_gross: { gt: 0 } }),
    },
    select: {
      id: true,
      status: true,
      site_id: true,
      customer_id: true,
      invoice_number: true,
      total_gross: true,
      updatedAt: true,
      credit_notes: {
        where: { ...ownership, status: CreditNoteStatus.FINALIZED },
        orderBy: { id: 'asc' },
        select: { id: true, total_gross: true },
      },
      payments: {
        where: { ...ownership, status: { in: [...SETTLED, ...PENDING] } },
        orderBy: { id: 'asc' },
        select: { id: true, status: true, amount: true },
      },
    },
  });
}

export type BankInvoice = Awaited<ReturnType<typeof loadBankInvoices>>[number];

export function outstanding(invoice: BankInvoice, excludePayment?: string) {
  return bankOutstanding(
    invoice.total_gross,
    invoice.credit_notes.map((credit) => credit.total_gross),
    invoice.payments
      .filter(
        (payment) =>
          payment.id !== excludePayment &&
          SETTLED.some((status) => status === payment.status),
      )
      .map((payment) => payment.amount),
  );
}

export function hasPendingSettlement(invoice: BankInvoice): boolean {
  return invoice.payments.some((payment) =>
    PENDING.some((status) => status === payment.status),
  );
}
