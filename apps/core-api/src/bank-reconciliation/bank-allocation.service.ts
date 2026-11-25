import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditActorType,
  AuditLogAction,
  BankTransactionStatus,
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import type { BankTransaction, Payment } from '@prisma/client';
import { createHash } from 'node:crypto';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import {
  lockFinanceSettings,
  lockFinanceSettingsAndAssertOpen,
} from '../finance/fiscal-lock.helpers.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { lockSitesAndAssertActive } from '../site/document-retarget.helpers.js';
import type {
  BankTransactionActionDto,
  ConfirmBankTransactionDto,
  IgnoreBankTransactionDto,
  UndoBankTransactionDto,
} from './bank-matching.dto.js';
import {
  assertAllBankInvoices,
  assertBankVersion,
  bankMatchConflict,
  invalidBankAllocation,
} from './bank-matching.errors.js';
import {
  hasPendingSettlement,
  loadBankAccess,
  loadBankInvoices,
  loadBankTransaction,
  outstanding,
  type BankInvoice,
} from './bank-matching.query.js';
import { isAllocatableCredit } from './bank-outstanding.js';
import {
  invoiceMatchEvidence,
  settledTransferPayments,
  unallocatedAmount,
} from './bank-suggestions.service.js';

type ActionContext = {
  tx: Prisma.TransactionClient;
  transfer: BankTransaction;
  access: Awaited<ReturnType<typeof loadBankAccess>>;
  payments: Payment[];
};

type Allocation = { invoiceId: string; amount: string | null };
type ConfirmCommand = {
  version: number;
  source: NonNullable<ConfirmBankTransactionDto['source']>;
  allocations: Allocation[];
  hash: string;
};

function fingerprint(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function confirmCommand(dto: ConfirmBankTransactionDto): ConfirmCommand {
  if (Boolean(dto.invoiceId) === Boolean(dto.allocations))
    throw invalidBankAllocation();

  const allocations = dto.invoiceId
    ? [{ invoiceId: dto.invoiceId, amount: null }]
    : (dto.allocations ?? []).map(({ invoiceId, amount }) => ({
        invoiceId,
        amount: new Prisma.Decimal(amount).toFixed(2),
      }));
  allocations.sort((a, b) => a.invoiceId.localeCompare(b.invoiceId));
  if (
    new Set(allocations.map(({ invoiceId }) => invoiceId)).size !==
      allocations.length ||
    allocations.some(({ amount }) => amount === '0.00')
  ) {
    throw invalidBankAllocation();
  }

  const source = dto.source ?? 'MANUAL';
  return {
    version: dto.transactionVersion,
    source,
    allocations,
    hash: fingerprint({ allocations, source }),
  };
}

function invoiceRevision(invoice: BankInvoice, excludePayment?: string) {
  return fingerprint({
    updatedAt: invoice.updatedAt,
    status: invoice.status,
    gross: invoice.total_gross,
    credits: invoice.credit_notes,
    payments: invoice.payments.filter(({ id }) => id !== excludePayment),
  });
}

async function assertInvoicePeriodsOpen(
  tx: Prisma.TransactionClient,
  tenantId: string,
  invoices: readonly BankInvoice[],
) {
  let earliest: Date | undefined;
  for (const { date } of invoices) {
    if (!earliest || date < earliest) earliest = date;
  }
  // The cutoff is tenant-wide, so the earliest invoice covers the entire split.
  if (earliest) {
    await lockFinanceSettingsAndAssertOpen(
      tx,
      tenantId,
      new Date(earliest.toISOString().slice(0, 10)),
    );
  }
}
function actionResponse(context: ActionContext): BankTransactionActionDto {
  const { transfer, payments, access } = context;
  return {
    id: transfer.id,
    status: transfer.status,
    version: transfer.version,
    unallocatedAmount: unallocatedAmount(transfer, payments).toFixed(2),
    allocations: payments
      .filter((payment) => access.siteIds.includes(payment.site_id))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((payment) => ({
        id: payment.id,
        invoiceId: payment.invoice_id,
        amount: payment.amount.toFixed(2),
      })),
  };
}

async function updateInvoice(
  context: ActionContext,
  invoice: BankInvoice,
  balance: Prisma.Decimal,
): Promise<BankInvoice> {
  const status = balance.gt(0) ? InvoiceStatus.ISSUED : InvoiceStatus.PAID;
  const updatedAt = new Date(
    Math.max(Date.now(), invoice.updatedAt.getTime() + 1),
  );
  const result = await context.tx.invoice.updateMany({
    where: {
      id: invoice.id,
      tenant_id: context.access.tenantId,
      site_id: { in: context.access.siteIds },
      legal_entity_id: context.transfer.legal_entity_id,
      updatedAt: invoice.updatedAt,
      status: invoice.status,
    },
    data: { status, updatedAt },
  });
  if (result.count !== 1) throw bankMatchConflict();
  return { ...invoice, status, updatedAt };
}

function buildAllocationPlan(
  context: ActionContext,
  command: ConfirmCommand,
  invoices: BankInvoice[],
) {
  const available = unallocatedAmount(context.transfer, context.payments);
  const invoicesById = new Map(
    invoices.map((invoice) => [invoice.id, invoice]),
  );
  const plan = command.allocations.map((line) => {
    const invoice = invoicesById.get(line.invoiceId);
    if (!invoice) throw new NotFoundException();
    const balance = outstanding(invoice);
    const amount =
      line.amount === null
        ? Prisma.Decimal.min(balance, available)
        : new Prisma.Decimal(line.amount);
    if (
      invoice.status !== InvoiceStatus.ISSUED ||
      hasPendingSettlement(invoice) ||
      !amount.gt(0) ||
      amount.gt(balance)
    ) {
      throw bankMatchConflict();
    }
    return { invoice, amount, balance };
  });

  if (unallocatedAmount(context.transfer, [...context.payments, ...plan]).lt(0))
    throw bankMatchConflict();
  return plan;
}

function isMatchingRetry(context: ActionContext, command: ConfirmCommand) {
  if (context.transfer.version !== command.version + 1) return false;
  const latest = context.payments.filter(
    (payment) => payment.bank_confirm_version === context.transfer.version,
  );
  return (
    latest.length === command.allocations.length &&
    latest.every((payment) => payment.request_hash === command.hash)
  );
}

@Injectable()
export class BankAllocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  confirm(
    id: string,
    dto: ConfirmBankTransactionDto,
  ): Promise<BankTransactionActionDto> {
    const command = confirmCommand(dto);
    return this.runAction(id, (context) => this.allocate(context, command));
  }

  undo(
    id: string,
    dto: UndoBankTransactionDto,
  ): Promise<BankTransactionActionDto> {
    return this.runAction(id, async (context) => {
      assertBankVersion(context.transfer.version, dto.expectedVersion);
      if (
        context.transfer.status === BankTransactionStatus.IGNORED &&
        context.transfer.is_credit &&
        !dto.allocationId
      ) {
        return this.commitAction(context, BankTransactionStatus.UNMATCHED, {
          event: 'bank_reconciliation.restore',
        });
      }
      return this.reverse(context, dto.allocationId);
    });
  }

  ignore(
    id: string,
    dto: IgnoreBankTransactionDto,
  ): Promise<BankTransactionActionDto> {
    return this.runAction(id, (context) => {
      assertBankVersion(context.transfer.version, dto.expectedVersion);
      if (
        !context.transfer.is_credit ||
        context.transfer.status !== BankTransactionStatus.UNMATCHED ||
        context.payments.length
      ) {
        throw bankMatchConflict();
      }
      return this.commitAction(context, BankTransactionStatus.IGNORED, {
        event: 'bank_reconciliation.ignore',
        reason: dto.reason.trim(),
      });
    });
  }

  private async runAction(
    id: string,
    action: (context: ActionContext) => Promise<BankTransactionActionDto>,
  ): Promise<BankTransactionActionDto> {
    const tenantId = await this.tenantContext.getTenantId();
    return this.prisma.$transaction(async (tx) => {
      await lockFinanceSettings(tx, tenantId);
      const settings = await tx.financeSettings.findFirst({
        where: { tenant_id: tenantId },
        select: { bank_reconciliation_enabled: true },
      });
      if (!settings?.bank_reconciliation_enabled) throw new NotFoundException();

      const access = await loadBankAccess(tx, this.tenantContext, tenantId);
      const transfer = await loadBankTransaction(tx, tenantId, id);
      const payments = await settledTransferPayments(tx, transfer);
      return action({ tx, transfer, access, payments });
    });
  }

  private async allocate(context: ActionContext, command: ConfirmCommand) {
    const { tx, transfer, access } = context;
    if (isMatchingRetry(context, command)) return actionResponse(context);
    assertBankVersion(transfer.version, command.version);
    if (
      transfer.status === BankTransactionStatus.IGNORED ||
      !isAllocatableCredit(transfer)
    ) {
      throw bankMatchConflict();
    }

    const invoices = await loadBankInvoices(tx, context, {
      ids: command.allocations.map(({ invoiceId }) => invoiceId),
    });
    const plan = buildAllocationPlan(context, command, invoices);
    await assertInvoicePeriodsOpen(tx, access.tenantId, invoices);
    const evidence = await invoiceMatchEvidence(
      tx,
      {
        transfer,
        siteIds: access.siteIds,
        availableAmount: unallocatedAmount(transfer, context.payments),
      },
      invoices,
    );
    await lockSitesAndAssertActive(
      tx,
      access.tenantId,
      invoices.map(({ site_id }) => site_id!),
    );

    const created = [];
    for (const line of plan) {
      created.push(await this.createPayment(context, command, line));
    }

    return this.commitAction(
      { ...context, payments: [...context.payments, ...created] },
      BankTransactionStatus.MATCHED,
      {
        event: 'bank_reconciliation.confirm',
        source: command.source,
        allocations: created.map((payment) => ({
          id: payment.id,
          invoiceId: payment.invoice_id,
          amount: payment.amount.toFixed(2),
          evidence: evidence.get(payment.invoice_id)?.reasons ?? [],
        })),
      },
    );
  }

  private async createPayment(
    context: ActionContext,
    command: ConfirmCommand,
    line: ReturnType<typeof buildAllocationPlan>[number],
  ) {
    const { tx, transfer, access } = context;
    const { invoice, amount, balance } = line;
    const updated = await updateInvoice(
      context,
      invoice,
      balance.minus(amount),
    );
    return tx.payment.create({
      data: {
        tenant_id: access.tenantId,
        invoice_id: invoice.id,
        site_id: invoice.site_id!,
        legal_entity_id: transfer.legal_entity_id,
        recorded_by_user_id: access.userId,
        status: PaymentStatus.SETTLED,
        method: PaymentMethod.BANK_TRANSFER,
        currency: 'EUR',
        amount,
        idempotency_key: `bank:${transfer.id}:${command.version}:${invoice.id}`,
        request_hash: command.hash,
        bank_transaction_id: transfer.id,
        bank_confirm_version: command.version + 1,
        bank_invoice_revision: invoiceRevision(updated),
      },
    });
  }

  private async reverse(context: ActionContext, allocationId?: string) {
    const { tx, payments, access } = context;
    if (!payments.length) throw bankMatchConflict();
    const latest = Math.max(
      ...payments.map((payment) => payment.bank_confirm_version ?? 0),
    );
    const selected = payments.filter((payment) =>
      allocationId
        ? payment.id === allocationId
        : payment.bank_confirm_version === latest,
    );
    if (
      !selected.length ||
      selected.some((payment) => !access.siteIds.includes(payment.site_id))
    ) {
      throw new NotFoundException();
    }
    const invoices = await loadBankInvoices(tx, context, {
      ids: selected.map(({ invoice_id }) => invoice_id),
    });
    assertAllBankInvoices(invoices.length, selected.length);
    await assertInvoicePeriodsOpen(tx, access.tenantId, invoices);
    const invoicesById = new Map(
      invoices.map((invoice) => [invoice.id, invoice]),
    );

    for (const payment of selected) {
      const invoice = invoicesById.get(payment.invoice_id)!;
      if (
        invoiceRevision(invoice, payment.id) !== payment.bank_invoice_revision
      )
        throw bankMatchConflict();
      await updateInvoice(context, invoice, outstanding(invoice, payment.id));
    }

    const ids = selected.map(({ id }) => id);
    const reversed = await tx.payment.updateMany({
      where: {
        tenant_id: access.tenantId,
        bank_transaction_id: context.transfer.id,
        site_id: { in: access.siteIds },
        id: { in: ids },
        status: PaymentStatus.SETTLED,
      },
      data: { status: PaymentStatus.REVERSED },
    });
    if (reversed.count !== selected.length) throw bankMatchConflict();

    const remaining = payments.filter((payment) => !ids.includes(payment.id));
    return this.commitAction(
      { ...context, payments: remaining },
      remaining.length
        ? BankTransactionStatus.MATCHED
        : BankTransactionStatus.UNMATCHED,
      {
        event: 'bank_reconciliation.undo',
        allocations: selected.map((payment) => ({
          id: payment.id,
          invoiceId: payment.invoice_id,
          amount: payment.amount.toFixed(2),
        })),
      },
    );
  }

  private async commitAction(
    context: ActionContext,
    status: BankTransactionStatus,
    after: Prisma.InputJsonObject,
  ): Promise<BankTransactionActionDto> {
    const { tx, transfer, access } = context;
    const version = transfer.version + 1;
    const updated = await tx.bankTransaction.updateMany({
      where: {
        id: transfer.id,
        tenant_id: access.tenantId,
        legal_entity_id: transfer.legal_entity_id,
        version: transfer.version,
      },
      data: { status, version },
    });
    if (updated.count !== 1) throw bankMatchConflict();

    const actor = this.tenantContext.getAuthenticatedUser();
    await tx.auditLog.create({
      data: {
        tenant_id: access.tenantId,
        entity_type: 'BankTransaction',
        entity_id: transfer.id,
        action: AuditLogAction.UPDATE,
        actor_user_id: access.userId,
        actor_email: actor?.email ?? null,
        actor_role: actor?.role ?? null,
        actor_type: AuditActorType.USER,
        before: { status: transfer.status, version: transfer.version },
        after: { ...after, status, version },
      },
    });
    return actionResponse({
      ...context,
      transfer: { ...transfer, status, version },
    });
  }
}
