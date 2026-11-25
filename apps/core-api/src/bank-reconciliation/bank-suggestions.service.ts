import { Injectable } from '@nestjs/common';
import {
  PaymentMethod,
  PaymentStatus,
  Prisma,
  type BankTransaction,
} from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { scoreBankMatch } from './bank-match-score.js';
import type { BankSuggestionsDto } from './bank-matching.dto.js';
import {
  loadBankAccess,
  loadBankInvoices,
  loadBankTransaction,
  outstanding,
  type BankInvoice,
} from './bank-matching.query.js';
import { isAllocatableCredit } from './bank-outstanding.js';

const SUGGESTION_LIMIT = 3;
const CANDIDATE_PAGE_SIZE = 200;

export function settledTransferPayments(
  db: Prisma.TransactionClient,
  transfer: BankTransaction,
) {
  return db.payment.findMany({
    where: {
      tenant_id: transfer.tenant_id,
      legal_entity_id: transfer.legal_entity_id,
      bank_transaction_id: transfer.id,
      method: PaymentMethod.BANK_TRANSFER,
      status: PaymentStatus.SETTLED,
    },
    orderBy: { id: 'asc' },
  });
}

export function unallocatedAmount(
  transfer: BankTransaction,
  payments: readonly { amount: Prisma.Decimal }[],
) {
  return payments.reduce(
    (remaining, payment) => remaining.minus(payment.amount),
    transfer.amount,
  );
}

export async function invoiceMatchEvidence(
  db: Prisma.TransactionClient,
  scope: {
    transfer: BankTransaction;
    siteIds: string[];
    availableAmount: Prisma.Decimal;
  },
  invoices: readonly BankInvoice[],
) {
  const { transfer, siteIds } = scope;
  const customerIds = [
    ...new Set(invoices.map(({ customer_id }) => customer_id)),
  ];
  const customers = await db.customer.findMany({
    where: { tenant_id: transfer.tenant_id, id: { in: customerIds } },
    select: { id: true, company_name: true, first_name: true, last_name: true },
  });
  const names = new Map(
    customers.map((customer) => [
      customer.id,
      customer.company_name ||
        [customer.first_name, customer.last_name].filter(Boolean).join(' '),
    ]),
  );
  const priorCustomers = await loadPriorRemitters(db, {
    transfer,
    siteIds,
    customerIds,
  });

  return new Map(
    invoices.map((invoice) => [
      invoice.id,
      scoreBankMatch(
        { ...transfer, availableAmount: scope.availableAmount },
        {
          number: invoice.invoice_number ?? '',
          name: names.get(invoice.customer_id) ?? '',
          outstanding: outstanding(invoice),
        },
        priorCustomers.has(invoice.customer_id),
      ),
    ]),
  );
}

async function loadPriorRemitters(
  db: Prisma.TransactionClient,
  scope: {
    transfer: BankTransaction;
    siteIds: string[];
    customerIds: string[];
  },
) {
  const { transfer, siteIds, customerIds } = scope;
  if (!transfer.remitter_iban_fingerprint) return new Set<string>();
  const ownership = {
    tenant_id: transfer.tenant_id,
    legal_entity_id: transfer.legal_entity_id,
  };
  const priorPayments = await db.payment.findMany({
    where: {
      ...ownership,
      site_id: { in: siteIds },
      method: PaymentMethod.BANK_TRANSFER,
      status: PaymentStatus.SETTLED,
      invoice: {
        ...ownership,
        site_id: { in: siteIds },
        customer_id: { in: customerIds },
      },
      bank_transaction: {
        ...ownership,
        id: { not: transfer.id },
        remitter_iban_fingerprint: transfer.remitter_iban_fingerprint,
      },
    },
    select: { invoice: { select: { customer_id: true } } },
  });
  return new Set(priorPayments.map(({ invoice }) => invoice.customer_id));
}

@Injectable()
export class BankSuggestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async list(id: string): Promise<BankSuggestionsDto> {
    const tenantId = await this.tenantContext.getTenantId();
    const access = await loadBankAccess(
      this.prisma,
      this.tenantContext,
      tenantId,
    );
    const transfer = await loadBankTransaction(this.prisma, tenantId, id);
    if (transfer.status === 'IGNORED' || !isAllocatableCredit(transfer))
      return { data: [] };

    const available = unallocatedAmount(
      transfer,
      await settledTransferPayments(this.prisma, transfer),
    );
    if (!available.gt(0)) return { data: [] };

    const evidenceScope = {
      transfer,
      siteIds: access.siteIds,
      availableAmount: available,
    };
    let afterId: string | undefined;
    let best: BankSuggestionsDto['data'] = [];
    do {
      const invoices = await loadBankInvoices(
        this.prisma,
        { transfer, access },
        {
          afterId,
          pageSize: CANDIDATE_PAGE_SIZE,
        },
      );
      if (!invoices.length) break;
      const page = await this.rankPage(invoices, evidenceScope);
      best = [...best, ...page]
        .sort(
          (a, b) => b.score - a.score || a.invoiceId.localeCompare(b.invoiceId),
        )
        .slice(0, SUGGESTION_LIMIT);
      afterId =
        invoices.length === CANDIDATE_PAGE_SIZE
          ? invoices.at(-1)?.id
          : undefined;
    } while (afterId);

    return { data: best };
  }

  private async rankPage(
    invoices: BankInvoice[],
    scope: Parameters<typeof invoiceMatchEvidence>[1],
  ) {
    const evidence = await invoiceMatchEvidence(this.prisma, scope, invoices);
    const available = scope.availableAmount;
    return invoices.flatMap((invoice) => {
      const balance = outstanding(invoice);
      const match = evidence.get(invoice.id);
      if (!balance.gt(0) || !match?.score) return [];
      const applied = Prisma.Decimal.min(available, balance);
      return [
        {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoice_number ?? '',
          outstandingAmount: balance.toFixed(2),
          suggestedAmount: applied.toFixed(2),
          remainingInvoiceAmount: balance.minus(applied).toFixed(2),
          unallocatedTransferAmount: available.minus(applied).toFixed(2),
          ...match,
        },
      ];
    });
  }
}
