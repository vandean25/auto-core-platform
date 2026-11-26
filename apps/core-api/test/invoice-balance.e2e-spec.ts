import type { INestApplication } from '@nestjs/common';
import {
  CreditNoteStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  computeInvoiceBalance,
  invoiceBalanceSelect,
  invoiceBalanceSql,
  mapInvoiceBalanceSqlRow,
  type InvoiceBalanceSqlRow,
} from '../src/finance/receivables/invoice-balance.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createE2eApp } from './helpers/e2e-suite.js';
import { bankFixture } from './support/bank-reconciliation-fixture.js';
import { createTenantAwarePrisma, createTestTenant } from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

const PARITY_CASES = [
  { number: 'RE-PARITY-01', gross: '120.00', creditNotes: [], payments: [] },
  {
    number: 'RE-PARITY-02',
    gross: '120.00',
    creditNotes: [],
    payments: [{ status: PaymentStatus.SETTLED, amount: '50.00' }],
  },
  {
    number: 'RE-PARITY-03',
    gross: '120.00',
    creditNotes: [],
    payments: [
      { status: PaymentStatus.SETTLED, amount: '30.00' },
      { status: PaymentStatus.SETTLED_EXTERNAL, amount: '40.00' },
    ],
  },
  {
    number: 'RE-PARITY-04',
    gross: '120.00',
    creditNotes: [
      { status: CreditNoteStatus.FINALIZED, gross: '20.00' },
      { status: CreditNoteStatus.DRAFT, gross: '50.00' },
      { status: CreditNoteStatus.VOID, gross: '30.00' },
    ],
    payments: [{ status: PaymentStatus.SETTLED, amount: '30.00' }],
  },
  {
    number: 'RE-PARITY-05',
    gross: '120.00',
    creditNotes: [],
    payments: [
      { status: PaymentStatus.SETTLED, amount: '20.00' },
      { status: PaymentStatus.REVERSED, amount: '100.00' },
      { status: PaymentStatus.REJECTED, amount: '40.00' },
      { status: PaymentStatus.PENDING, amount: '30.00' },
      { status: PaymentStatus.UNKNOWN, amount: '10.00' },
    ],
  },
  {
    number: 'RE-PARITY-06',
    gross: '100.00',
    creditNotes: [{ status: CreditNoteStatus.FINALIZED, gross: '10.00' }],
    payments: [{ status: PaymentStatus.SETTLED, amount: '115.00' }],
  },
  {
    number: 'RE-PARITY-07',
    gross: '0.30',
    creditNotes: [],
    payments: [
      { status: PaymentStatus.SETTLED, amount: '0.10' },
      { status: PaymentStatus.SETTLED, amount: '0.20' },
    ],
  },
] as const;

describe('Invoice balance TS == SQL parity (e2e)', () => {
  let app: INestApplication;
  let base: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;
  let otherTenantId: string;
  let fixture: Awaited<ReturnType<typeof bankFixture>>;
  let otherFixture: Awaited<ReturnType<typeof bankFixture>>;
  const invoiceIds: string[] = [];

  beforeAll(async () => {
    app = await createE2eApp();
    base = app.get(PrismaService);
    const tenant = await createTestTenant(base, 'aut1074-parity');
    const otherTenant = await createTestTenant(base, 'aut1074-other');
    tenantId = tenant.tenantId;
    otherTenantId = otherTenant.tenantId;
    prisma = createTenantAwarePrisma(base, tenantId);
    fixture = await bankFixture(prisma, tenantId);
    otherFixture = await bankFixture(
      createTenantAwarePrisma(base, otherTenantId),
      otherTenantId,
    );

    for (const item of PARITY_CASES) {
      const inv = await fixture.invoice(item.number, Number(item.gross));
      invoiceIds.push(inv.id);
      for (const cn of item.creditNotes) {
        await prisma.creditNote.create({
          data: {
            ...fixture.ownership,
            site_id: fixture.site.id,
            original_invoice_id: inv.id,
            status: cn.status,
            date: fixture.date,
            reason: 'Parity fixture',
            total_net: cn.gross,
            total_tax: '0.00',
            total_gross: cn.gross,
          },
        });
      }
      for (const p of item.payments) {
        await prisma.payment.create({
          data: {
            ...fixture.ownership,
            site_id: fixture.site.id,
            invoice_id: inv.id,
            status: p.status,
            method: PaymentMethod.CASH,
            amount: p.amount,
            currency: 'EUR',
            idempotency_key: `parity:${randomUUID()}`,
            request_hash: 'parity-hash',
          },
        });
      }
    }
  });

  afterAll(async () => teardownTestApp(app, base));

  it('computes identical balance fields in TS and SQL across all scenarios', async () => {
    const sqlRows = await base.$queryRaw<InvoiceBalanceSqlRow[]>(
      Prisma.sql`WITH balances AS (${invoiceBalanceSql(tenantId)}) SELECT * FROM balances ORDER BY outstanding DESC, invoice_id ASC`,
    );
    const tsInvoices = await prisma.invoice.findMany({
      where: { tenant_id: tenantId, id: { in: invoiceIds } },
      select: { id: true, ...invoiceBalanceSelect(tenantId) },
    });
    const tsById = new Map(
      tsInvoices.map((inv) => [inv.id, computeInvoiceBalance(inv)]),
    );

    expect(sqlRows).toHaveLength(PARITY_CASES.length);
    for (const row of sqlRows) {
      const sqlBal = mapInvoiceBalanceSqlRow(row);
      const tsBal = tsById.get(row.invoice_id)!;
      expect(sqlBal.gross.toFixed(2)).toBe(tsBal.gross.toFixed(2));
      expect(sqlBal.credited.toFixed(2)).toBe(tsBal.credited.toFixed(2));
      expect(sqlBal.paid.toFixed(2)).toBe(tsBal.paid.toFixed(2));
      expect(sqlBal.pending.toFixed(2)).toBe(tsBal.pending.toFixed(2));
      expect(sqlBal.outstanding.toFixed(2)).toBe(tsBal.outstanding.toFixed(2));
      expect(sqlBal.signedBalance.toFixed(2)).toBe(
        tsBal.signedBalance.toFixed(2),
      );
    }
  });

  it('supports WHERE, ORDER BY, and GROUP BY composition in SQL', async () => {
    const summary = await base.$queryRaw<
      Array<{ open_count: bigint; total_outstanding: Prisma.Decimal }>
    >(
      Prisma.sql`
        WITH balances AS (${invoiceBalanceSql(tenantId)})
        SELECT COUNT(*)::bigint AS open_count, COALESCE(SUM(outstanding), 0) AS total_outstanding
        FROM balances
        WHERE outstanding > 0
      `,
    );
    expect(Number(summary[0].open_count)).toBe(5);
    expect(new Prisma.Decimal(summary[0].total_outstanding).toFixed(2)).toBe(
      '410.00',
    );
  });

  it('excludes other tenants from invoiceBalanceSql', async () => {
    const otherInv = await otherFixture.invoice('RE-PARITY-OTHER', 999);
    const sqlRows = await base.$queryRaw<InvoiceBalanceSqlRow[]>(
      Prisma.sql`WITH balances AS (${invoiceBalanceSql(tenantId)}) SELECT * FROM balances`,
    );
    expect(sqlRows.some((row) => row.invoice_id === otherInv.id)).toBe(false);
  });
});
