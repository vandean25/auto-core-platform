/**
 * Deletes Vehicle UPDATE audit rows whose changed fields are empty
 * (no fields, or only updatedAt / version).
 *
 * Default is dry-run (prints the count). Pass --execute to delete.
 *
 * Usage (from repository root):
 *   npm run audit:purge-empty-vehicle-updates --workspace=core-api
 *   npm run audit:purge-empty-vehicle-updates --workspace=core-api -- --execute
 */
import 'dotenv/config';
import { AuditLogAction, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { isDirectRun } from './is-direct-run.mjs';

const BATCH_SIZE = 5_000;
const BOOKKEEPING_FIELDS = new Set(['updatedAt', 'version']);

export function isEmptyVehicleUpdateChangedFields(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (field) => typeof field === 'string' && BOOKKEEPING_FIELDS.has(field),
    )
  );
}

export function parsePurgeEmptyVehicleUpdateAuditsArgv(argv: string[]): {
  execute: boolean;
} {
  const flags = argv.slice(2);
  const execute = flags.includes('--execute');
  const dryRun = flags.includes('--dry-run');
  if (execute && dryRun) {
    throw new Error('Pass either --dry-run or --execute, not both.');
  }
  const unknown = flags.filter(
    (flag) => flag !== '--execute' && flag !== '--dry-run',
  );
  if (unknown.length > 0) {
    throw new Error(
      `Unknown argument ${unknown[0]}. Usage: npm run audit:purge-empty-vehicle-updates --workspace=core-api -- [--dry-run|--execute]`,
    );
  }
  return { execute };
}

type AuditRow = { id: string; changed_fields: unknown };

export type EmptyVehicleUpdateAuditStore = {
  auditLog: {
    findMany: (args: {
      where: { entity_type: string; action: AuditLogAction; id?: { gt: string } };
      orderBy: { id: 'asc' };
      take: number;
      select: { id: true; changed_fields: true };
    }) => Promise<AuditRow[]>;
    deleteMany: (args: { where: { id: { in: string[] } } }) => Promise<{ count: number }>;
  };
};

export async function purgeEmptyVehicleUpdateAudits(
  store: EmptyVehicleUpdateAuditStore,
  options: { execute: boolean },
): Promise<{ matched: number; deleted: number }> {
  let cursor: string | undefined;
  let matched = 0;
  let deleted = 0;

  for (;;) {
    const rows = await store.auditLog.findMany({
      where: {
        entity_type: 'Vehicle',
        action: AuditLogAction.UPDATE,
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      select: { id: true, changed_fields: true },
    });
    const emptyIds = rows
      .filter((row) => isEmptyVehicleUpdateChangedFields(row.changed_fields))
      .map((row) => row.id);
    matched += emptyIds.length;

    if (options.execute && emptyIds.length > 0) {
      const result = await store.auditLog.deleteMany({
        where: { id: { in: emptyIds } },
      });
      deleted += result.count;
    }

    if (rows.length < BATCH_SIZE) {
      break;
    }
    const lastId = rows[rows.length - 1]?.id;
    if (!lastId || lastId === cursor) {
      break;
    }
    cursor = lastId;
  }

  return { matched, deleted };
}

export async function runPurgeEmptyVehicleUpdateAuditsCli(
  argv: string[] = process.argv,
  store?: EmptyVehicleUpdateAuditStore,
): Promise<{ matched: number; deleted: number }> {
  const { execute } = parsePurgeEmptyVehicleUpdateAuditsArgv(argv);
  if (store) {
    return purgeEmptyVehicleUpdateAudits(store, { execute });
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set.');
  }

  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  try {
    return await purgeEmptyVehicleUpdateAudits(prisma, { execute });
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

if (
  isDirectRun({
    moduleUrl: import.meta.url,
    moduleFilename: import.meta.filename,
    argv1: process.argv[1],
  })
) {
  runPurgeEmptyVehicleUpdateAuditsCli()
    .then((result) => {
      const mode = process.argv.includes('--execute') ? 'execute' : 'dry-run';
      console.log(
        `${mode}: matched ${result.matched} empty Vehicle UPDATE audit rows` +
          (mode === 'execute' ? `, deleted ${result.deleted}` : ''),
      );
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error(
        error instanceof Error ? error.message : `Unexpected error: ${String(error)}`,
      );
      process.exit(1);
    });
}
