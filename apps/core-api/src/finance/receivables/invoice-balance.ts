import { CreditNoteStatus, PaymentStatus, Prisma } from '@prisma/client';

export type DecimalInput =
  Prisma.Decimal | string | number | { toFixed: (digits?: number) => string };

export type InvoiceBalanceCreditNote = {
  status: CreditNoteStatus;
  total_gross: DecimalInput;
};

export type InvoiceBalancePayment = {
  id?: string;
  status: PaymentStatus;
  amount: DecimalInput;
};

export type InvoiceBalanceInput = {
  total_gross: DecimalInput;
  credit_notes?: readonly InvoiceBalanceCreditNote[];
  payments?: readonly InvoiceBalancePayment[];
};

export type InvoiceBalance = {
  gross: Prisma.Decimal;
  credited: Prisma.Decimal;
  paid: Prisma.Decimal;
  pending: Prisma.Decimal;
  outstanding: Prisma.Decimal;
  signedBalance: Prisma.Decimal;
};

export type InvoiceBalanceSqlRow = {
  invoice_id: string;
  gross: DecimalInput;
  credited: DecimalInput;
  paid: DecimalInput;
  pending: DecimalInput;
  outstanding: DecimalInput;
  signed_balance: DecimalInput;
};

const SETTLED_PAYMENT_STATUSES = new Set<string>([
  PaymentStatus.SETTLED,
  PaymentStatus.SETTLED_EXTERNAL,
]);

const PENDING_PAYMENT_STATUSES = new Set<string>([
  PaymentStatus.PENDING,
  PaymentStatus.UNKNOWN,
]);

function toMoneyDecimal(value: DecimalInput): Prisma.Decimal {
  if (Prisma.Decimal.isDecimal(value)) {
    return value.toDecimalPlaces(2);
  }
  if (typeof value === 'object' && value !== null) {
    return new Prisma.Decimal(value.toFixed(2)).toDecimalPlaces(2);
  }
  return new Prisma.Decimal(value).toDecimalPlaces(2);
}

export function computeInvoiceBalance(
  invoice: InvoiceBalanceInput,
  options?: { excludePaymentId?: string },
): InvoiceBalance {
  const gross = toMoneyDecimal(invoice.total_gross);

  let credited = new Prisma.Decimal(0);
  for (const creditNote of invoice.credit_notes ?? []) {
    if (creditNote.status === CreditNoteStatus.FINALIZED) {
      credited = credited.plus(toMoneyDecimal(creditNote.total_gross));
    }
  }
  credited = credited.toDecimalPlaces(2);

  let paid = new Prisma.Decimal(0);
  let pending = new Prisma.Decimal(0);
  for (const payment of invoice.payments ?? []) {
    if (options?.excludePaymentId && payment.id === options.excludePaymentId) {
      continue;
    }
    if (SETTLED_PAYMENT_STATUSES.has(payment.status)) {
      paid = paid.plus(toMoneyDecimal(payment.amount));
    } else if (PENDING_PAYMENT_STATUSES.has(payment.status)) {
      pending = pending.plus(toMoneyDecimal(payment.amount));
    }
  }
  paid = paid.toDecimalPlaces(2);
  pending = pending.toDecimalPlaces(2);

  const signedBalance = gross.minus(credited).minus(paid).toDecimalPlaces(2);
  const outstanding = Prisma.Decimal.max(0, signedBalance).toDecimalPlaces(2);

  return {
    gross,
    credited,
    paid,
    pending,
    outstanding,
    signedBalance,
  };
}

export function invoiceBalanceSelect(tenantId: string) {
  return {
    total_gross: true,
    credit_notes: {
      where: {
        tenant_id: tenantId,
        status: CreditNoteStatus.FINALIZED,
      },
      orderBy: { id: 'asc' as const },
      select: {
        id: true,
        status: true,
        total_gross: true,
      },
    },
    payments: {
      where: {
        tenant_id: tenantId,
        status: {
          in: [
            PaymentStatus.SETTLED,
            PaymentStatus.SETTLED_EXTERNAL,
            PaymentStatus.PENDING,
            PaymentStatus.UNKNOWN,
          ],
        },
      },
      orderBy: { id: 'asc' as const },
      select: {
        id: true,
        status: true,
        amount: true,
      },
    },
  } satisfies Prisma.InvoiceSelect;
}

/**
 * Composable SQL counterpart to `computeInvoiceBalance` for WHERE / ORDER BY / GROUP BY.
 * Returns one row per invoice in `tenantId` with exact 2-decimal NUMERIC columns.
 */
export function invoiceBalanceSql(tenantId: string): Prisma.Sql {
  return Prisma.sql`
    SELECT
      i.id AS invoice_id,
      ROUND(i.total_gross, 2) AS gross,
      ROUND(COALESCE(cn.credited, 0), 2) AS credited,
      ROUND(COALESCE(p.paid, 0), 2) AS paid,
      ROUND(COALESCE(p.pending, 0), 2) AS pending,
      GREATEST(
        0::numeric,
        ROUND(i.total_gross - COALESCE(cn.credited, 0) - COALESCE(p.paid, 0), 2)
      ) AS outstanding,
      ROUND(i.total_gross - COALESCE(cn.credited, 0) - COALESCE(p.paid, 0), 2) AS signed_balance
    FROM invoices i
    LEFT JOIN (
      SELECT
        original_invoice_id AS invoice_id,
        SUM(total_gross) AS credited
      FROM credit_notes
      WHERE tenant_id = ${tenantId}
        AND status = 'FINALIZED'::"CreditNoteStatus"
      GROUP BY original_invoice_id
    ) cn ON cn.invoice_id = i.id
    LEFT JOIN (
      SELECT
        invoice_id,
        SUM(amount) FILTER (
          WHERE status IN (
            'SETTLED'::"PaymentStatus",
            'SETTLED_EXTERNAL'::"PaymentStatus"
          )
        ) AS paid,
        SUM(amount) FILTER (
          WHERE status IN (
            'PENDING'::"PaymentStatus",
            'UNKNOWN'::"PaymentStatus"
          )
        ) AS pending
      FROM payments
      WHERE tenant_id = ${tenantId}
      GROUP BY invoice_id
    ) p ON p.invoice_id = i.id
    WHERE i.tenant_id = ${tenantId}
  `;
}

export function mapInvoiceBalanceSqlRow(
  row: InvoiceBalanceSqlRow,
): InvoiceBalance {
  return {
    gross: toMoneyDecimal(row.gross),
    credited: toMoneyDecimal(row.credited),
    paid: toMoneyDecimal(row.paid),
    pending: toMoneyDecimal(row.pending),
    outstanding: toMoneyDecimal(row.outstanding),
    signedBalance: toMoneyDecimal(row.signed_balance),
  };
}
