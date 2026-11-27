import { CreditNoteStatus, PaymentStatus, Prisma } from '@prisma/client';
import {
  computeInvoiceBalance,
  invoiceBalanceSelect,
  mapInvoiceBalanceSqlRow,
} from './invoice-balance.js';

describe('computeInvoiceBalance', () => {
  it.each([
    {
      name: 'unpaid invoice',
      gross: '120.00',
      creditNotes: [],
      payments: [],
      expected: {
        gross: '120.00',
        credited: '0.00',
        paid: '0.00',
        pending: '0.00',
        outstanding: '120.00',
        signedBalance: '120.00',
      },
    },
    {
      name: 'partial settled payment',
      gross: '120.00',
      creditNotes: [],
      payments: [{ status: PaymentStatus.SETTLED, amount: '50.00' }],
      expected: {
        gross: '120.00',
        credited: '0.00',
        paid: '50.00',
        pending: '0.00',
        outstanding: '70.00',
        signedBalance: '70.00',
      },
    },
    {
      name: 'multiple settled and external payments',
      gross: '120.00',
      creditNotes: [],
      payments: [
        { status: PaymentStatus.SETTLED, amount: '30.00' },
        { status: PaymentStatus.SETTLED_EXTERNAL, amount: '40.00' },
        { status: PaymentStatus.SETTLED, amount: '50.00' },
      ],
      expected: {
        gross: '120.00',
        credited: '0.00',
        paid: '120.00',
        pending: '0.00',
        outstanding: '0.00',
        signedBalance: '0.00',
      },
    },
    {
      name: 'finalized credit note with partial payment; draft and void CNs ignored',
      gross: '120.00',
      creditNotes: [
        { status: CreditNoteStatus.FINALIZED, total_gross: '20.00' },
        { status: CreditNoteStatus.DRAFT, total_gross: '50.00' },
        { status: CreditNoteStatus.VOID, total_gross: '30.00' },
      ],
      payments: [{ status: PaymentStatus.SETTLED, amount: '30.00' }],
      expected: {
        gross: '120.00',
        credited: '20.00',
        paid: '30.00',
        pending: '0.00',
        outstanding: '70.00',
        signedBalance: '70.00',
      },
    },
    {
      name: 'reversed and rejected payments ignored; pending and unknown reported in pending only',
      gross: '120.00',
      creditNotes: [],
      payments: [
        { status: PaymentStatus.SETTLED, amount: '20.00' },
        { status: PaymentStatus.REVERSED, amount: '100.00' },
        { status: PaymentStatus.REJECTED, amount: '50.00' },
        { status: PaymentStatus.PENDING, amount: '30.00' },
        { status: PaymentStatus.UNKNOWN, amount: '10.00' },
      ],
      expected: {
        gross: '120.00',
        credited: '0.00',
        paid: '20.00',
        pending: '40.00',
        outstanding: '100.00',
        signedBalance: '100.00',
      },
    },
    {
      name: 'overpayment yields negative signedBalance and zero outstanding',
      gross: '100.00',
      creditNotes: [{ status: CreditNoteStatus.FINALIZED, total_gross: '10.00' }],
      payments: [{ status: PaymentStatus.SETTLED, amount: '115.00' }],
      expected: {
        gross: '100.00',
        credited: '10.00',
        paid: '115.00',
        pending: '0.00',
        outstanding: '0.00',
        signedBalance: '-25.00',
      },
    },
    {
      name: 'decimal precision avoids binary float drift (0.10 + 0.20 == 0.30)',
      gross: '0.30',
      creditNotes: [],
      payments: [
        { status: PaymentStatus.SETTLED, amount: '0.10' },
        { status: PaymentStatus.SETTLED, amount: '0.20' },
      ],
      expected: {
        gross: '0.30',
        credited: '0.00',
        paid: '0.30',
        pending: '0.00',
        outstanding: '0.00',
        signedBalance: '0.00',
      },
    },
  ])('$name', ({ gross, creditNotes, payments, expected }) => {
    const result = computeInvoiceBalance({
      total_gross: new Prisma.Decimal(gross),
      credit_notes: creditNotes.map((cn) => ({
        status: cn.status,
        total_gross: new Prisma.Decimal(cn.total_gross),
      })),
      payments: payments.map((p) => ({
        status: p.status,
        amount: new Prisma.Decimal(p.amount),
      })),
    });

    expect({
      gross: result.gross.toFixed(2),
      credited: result.credited.toFixed(2),
      paid: result.paid.toFixed(2),
      pending: result.pending.toFixed(2),
      outstanding: result.outstanding.toFixed(2),
      signedBalance: result.signedBalance.toFixed(2),
    }).toEqual(expected);
  });

  it('excludes a specific payment id when excludePaymentId is provided', () => {
    const result = computeInvoiceBalance(
      {
        total_gross: new Prisma.Decimal('120.00'),
        credit_notes: [],
        payments: [
          { id: 'p-1', status: PaymentStatus.SETTLED, amount: '50.00' },
          { id: 'p-2', status: PaymentStatus.SETTLED, amount: '70.00' },
        ],
      },
      { excludePaymentId: 'p-2' },
    );

    expect(result.paid.toFixed(2)).toBe('50.00');
    expect(result.outstanding.toFixed(2)).toBe('70.00');
    expect(result.signedBalance.toFixed(2)).toBe('70.00');
  });

  it('builds a tenant-scoped Prisma select fragment', () => {
    const select = invoiceBalanceSelect('tenant-42');
    expect(select.credit_notes.where.tenant_id).toBe('tenant-42');
    expect(select.credit_notes.where.status).toBe(CreditNoteStatus.FINALIZED);
    expect(select.payments.where.tenant_id).toBe('tenant-42');
  });

  it('maps SQL row values to 2-decimal Prisma.Decimal fields', () => {
    const mapped = mapInvoiceBalanceSqlRow({
      invoice_id: 'inv-1',
      gross: '120.00',
      credited: '20.00',
      paid: '30.00',
      pending: '10.00',
      outstanding: '70.00',
      signed_balance: '70.00',
    });

    expect(mapped.gross.toFixed(2)).toBe('120.00');
    expect(mapped.credited.toFixed(2)).toBe('20.00');
    expect(mapped.paid.toFixed(2)).toBe('30.00');
    expect(mapped.pending.toFixed(2)).toBe('10.00');
    expect(mapped.outstanding.toFixed(2)).toBe('70.00');
    expect(mapped.signedBalance.toFixed(2)).toBe('70.00');
  });
});
