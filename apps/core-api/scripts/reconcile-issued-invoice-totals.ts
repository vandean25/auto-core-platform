/**
 * Reconciles stored Invoice total_net / total_tax / total_gross against the
 * immutable snapshot totals for already-issued invoices.
 *
 * Default is dry-run (lists mismatches without mutating). Pass --apply to update.
 * Optional --tenant-id <uuid> scopes the run to a single tenant.
 *
 * Usage (from repository root):
 *   npm run invoices:reconcile-totals --workspace=core-api
 *   npm run invoices:reconcile-totals --workspace=core-api -- --tenant-id <uuid>
 *   npm run invoices:reconcile-totals --workspace=core-api -- --apply
 */
import 'dotenv/config';
import {
  InvoiceStatus,
  InvoiceTaxMode,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { isDirectRun } from './is-direct-run.mjs';

const BATCH_SIZE = 500;
const ISSUED_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.ISSUED,
  InvoiceStatus.FINALIZED,
];

export type ReconcileCliArgs = {
  apply: boolean;
  tenantId?: string;
};

export type InvoiceTotalsTuple = {
  total_net: string;
  total_tax: string;
  total_gross: string;
};

export type InvoiceTotalsMismatch = {
  id: string;
  number: string | null;
  tenant: string;
  stored: InvoiceTotalsTuple;
  snapshot: InvoiceTotalsTuple;
  diff: InvoiceTotalsTuple;
};

type IssuedInvoiceRow = {
  id: string;
  tenant_id: string;
  invoice_number: string | null;
  status: InvoiceStatus;
  total_net: Prisma.Decimal;
  total_tax: Prisma.Decimal;
  total_gross: Prisma.Decimal;
  snapshot: unknown;
};

export type IssuedInvoiceTotalsStore = {
  invoice: {
    findMany: (args: {
      where: {
        tenant_id?: string;
        status: { in: InvoiceStatus[] };
        id?: { gt: string };
      };
      orderBy: { id: 'asc' };
      take: number;
      select: {
        id: true;
        tenant_id: true;
        invoice_number: true;
        status: true;
        total_net: true;
        total_tax: true;
        total_gross: true;
        snapshot: true;
      };
    }) => Promise<IssuedInvoiceRow[]>;
    updateMany: (args: {
      where: { id: string; tenant_id: string };
      data: {
        total_net: Prisma.Decimal;
        total_tax: Prisma.Decimal;
        total_gross: Prisma.Decimal;
      };
    }) => Promise<{ count: number }>;
  };
};

export function parseReconcileIssuedInvoiceTotalsArgv(
  argv: string[],
): ReconcileCliArgs {
  const args = argv.slice(2);
  let apply = false;
  let dryRun = false;
  let tenantId: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--apply') {
      apply = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--tenant-id') {
      const next = args[i + 1];
      if (!next || next.startsWith('--')) {
        throw new Error('--tenant-id requires a value.');
      }
      tenantId = next;
      i += 1;
    } else {
      throw new Error(
        `Unknown argument ${arg}. Usage: [--dry-run|--apply] [--tenant-id <uuid>]`,
      );
    }
  }

  if (apply && dryRun) {
    throw new Error('Pass either --dry-run or --apply, not both.');
  }

  return { apply, tenantId };
}

function readSnapshotTotals(
  snapshot: unknown,
): { net: Prisma.Decimal; tax: Prisma.Decimal; gross: Prisma.Decimal } | null {
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }
  const record = snapshot as Record<string, unknown>;
  if (record.tax_mode === InvoiceTaxMode.MARGIN_SCHEME) {
    return null;
  }
  if (
    typeof record.total_net !== 'string' ||
    typeof record.total_tax !== 'string' ||
    typeof record.total_gross !== 'string'
  ) {
    return null;
  }
  return {
    net: new Prisma.Decimal(record.total_net),
    tax: new Prisma.Decimal(record.total_tax),
    gross: new Prisma.Decimal(record.total_gross),
  };
}

function detectMismatch(row: IssuedInvoiceRow): {
  mismatch: InvoiceTotalsMismatch;
  snapshotDecimals: {
    net: Prisma.Decimal;
    tax: Prisma.Decimal;
    gross: Prisma.Decimal;
  };
} | null {
  const snap = readSnapshotTotals(row.snapshot);
  if (!snap) {
    return null;
  }
  const storedNet = new Prisma.Decimal(row.total_net);
  const storedTax = new Prisma.Decimal(row.total_tax);
  const storedGross = new Prisma.Decimal(row.total_gross);

  if (
    storedNet.eq(snap.net) &&
    storedTax.eq(snap.tax) &&
    storedGross.eq(snap.gross)
  ) {
    return null;
  }

  return {
    mismatch: {
      id: row.id,
      number: row.invoice_number,
      tenant: row.tenant_id,
      stored: {
        total_net: storedNet.toFixed(2),
        total_tax: storedTax.toFixed(2),
        total_gross: storedGross.toFixed(2),
      },
      snapshot: {
        total_net: snap.net.toFixed(2),
        total_tax: snap.tax.toFixed(2),
        total_gross: snap.gross.toFixed(2),
      },
      diff: {
        total_net: snap.net.sub(storedNet).toFixed(2),
        total_tax: snap.tax.sub(storedTax).toFixed(2),
        total_gross: snap.gross.sub(storedGross).toFixed(2),
      },
    },
    snapshotDecimals: snap,
  };
}

async function processInvoiceBatch(
  store: IssuedInvoiceTotalsStore,
  rows: IssuedInvoiceRow[],
  apply: boolean,
  mismatches: InvoiceTotalsMismatch[],
): Promise<number> {
  let updated = 0;
  for (const row of rows) {
    const detected = detectMismatch(row);
    if (!detected) continue;
    mismatches.push(detected.mismatch);
    if (apply) {
      const res = await store.invoice.updateMany({
        where: { id: row.id, tenant_id: row.tenant_id },
        data: {
          total_net: detected.snapshotDecimals.net,
          total_tax: detected.snapshotDecimals.tax,
          total_gross: detected.snapshotDecimals.gross,
        },
      });
      updated += res.count;
    }
  }
  return updated;
}

export async function reconcileIssuedInvoiceTotals(
  store: IssuedInvoiceTotalsStore,
  options: ReconcileCliArgs,
): Promise<{
  scanned: number;
  mismatches: InvoiceTotalsMismatch[];
  updated: number;
}> {
  let cursor: string | undefined;
  let scanned = 0;
  let updated = 0;
  const mismatches: InvoiceTotalsMismatch[] = [];

  for (;;) {
    const rows = await store.invoice.findMany({
      where: {
        ...(options.tenantId ? { tenant_id: options.tenantId } : {}),
        status: { in: ISSUED_STATUSES },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      select: {
        id: true,
        tenant_id: true,
        invoice_number: true,
        status: true,
        total_net: true,
        total_tax: true,
        total_gross: true,
        snapshot: true,
      },
    });

    scanned += rows.length;
    updated += await processInvoiceBatch(store, rows, options.apply, mismatches);

    const lastId = rows[rows.length - 1]?.id;
    if (rows.length < BATCH_SIZE || !lastId || lastId === cursor) {
      break;
    }
    cursor = lastId;
  }

  return { scanned, mismatches, updated };
}

export async function runReconcileIssuedInvoiceTotalsCli(
  argv: string[] = process.argv,
): Promise<{
  scanned: number;
  mismatches: InvoiceTotalsMismatch[];
  updated: number;
}> {
  const options = parseReconcileIssuedInvoiceTotalsArgv(argv);
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set.');
  }
  const pool = new Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    return await reconcileIssuedInvoiceTotals(prisma, options);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

if (isDirectRun(import.meta.url)) {
  runReconcileIssuedInvoiceTotalsCli()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
