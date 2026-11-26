import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  CreditNoteStatus,
  InvoiceStatus,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import type { BankTransaction } from '@prisma/client';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import { computeInvoiceBalance } from '../finance/receivables/invoice-balance.js';

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
  lookup: { ids: string[] } | { afterId: string | undefined; pageSize: number },
) {
  const { access, transfer } = scope;
  const ownership = {
    tenant_id: access.tenantId,
    legal_entity_id: transfer.legal_entity_id,
    site_id: { in: access.siteIds },
  };
  const selection =
    'ids' in lookup
      ? { id: { in: lookup.ids } }
      : {
          id: lookup.afterId ? { gt: lookup.afterId } : undefined,
          status: InvoiceStatus.ISSUED,
          total_gross: { gt: 0 },
          payments: { none: { ...ownership, status: { in: PENDING } } },
        };
  return db.invoice.findMany({
    orderBy: { id: 'asc' },
    take: 'pageSize' in lookup ? lookup.pageSize : undefined,
    where: {
      ...ownership,
      currency: 'EUR',
      ...selection,
    },
    select: {
      id: true,
      status: true,
      site_id: true,
      customer_id: true,
      invoice_number: true,
      total_gross: true,
      date: true,
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

function toBalanceInput(invoice: BankInvoice) {
  return {
    total_gross: invoice.total_gross,
    payments: invoice.payments,
    credit_notes: invoice.credit_notes.map(({ total_gross }) => ({
      status: CreditNoteStatus.FINALIZED,
      total_gross,
    })),
  };
}

export function outstanding(invoice: BankInvoice, excludePayment?: string) {
  return computeInvoiceBalance(toBalanceInput(invoice), {
    excludePaymentId: excludePayment,
  }).outstanding;
}

export function hasPendingSettlement(invoice: BankInvoice): boolean {
  return computeInvoiceBalance(toBalanceInput(invoice)).pending.gt(0);
}
