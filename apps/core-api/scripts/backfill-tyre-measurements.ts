/**
 * Converts legacy tyre tread JSON on TyreSet and TyreSetEvent rows into
 * TyreMeasurement / TyreWheelReading rows (middle-point value only).
 *
 * The run is idempotent: converted parents are linked through
 * `source = LEGACY_TREAD_JSON` and `source_ref = "set:<id>" | "event:<id>"`,
 * so a second run creates nothing. Legacy JSON is never modified.
 *
 * Default is dry-run (counts only). Pass --execute to write.
 *
 * Usage (from repository root):
 *   npm run db:backfill:tyre-measurements --workspace=core-api
 *   npm run db:backfill:tyre-measurements --workspace=core-api -- --execute
 *   npm run db:backfill:tyre-measurements --workspace=core-api -- --tenant=<tenant-id>
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { isDirectRun } from './is-direct-run.mjs';
import {
  backfillTyreMeasurements,
  type TyreBackfillOptions,
  type TyreBackfillSummary,
} from '../src/tyre-measurement/tyre-measurement-backfill.js';

export function parseBackfillArgv(argv: string[]): TyreBackfillOptions {
  const flags = argv.slice(2);
  const execute = flags.includes('--execute');
  if (execute && flags.includes('--dry-run')) {
    throw new Error('Pass either --dry-run or --execute, not both.');
  }
  const tenantFlag = flags.find((flag) => flag.startsWith('--tenant='));
  const tenantId = tenantFlag?.slice('--tenant='.length).trim() || undefined;
  if (tenantFlag && !tenantId) {
    throw new Error('--tenant requires a tenant id.');
  }
  const unknown = flags.filter(
    (flag) =>
      flag !== '--execute' && flag !== '--dry-run' && flag !== tenantFlag,
  );
  if (unknown.length > 0) {
    throw new Error(
      `Unknown argument ${unknown[0]}. Usage: npm run db:backfill:tyre-measurements --workspace=core-api -- [--dry-run|--execute] [--tenant=<id>]`,
    );
  }
  return { execute, tenantId };
}

export async function runBackfillTyreMeasurementsCli(
  argv: string[] = process.argv,
): Promise<TyreBackfillSummary> {
  const options = parseBackfillArgv(argv);
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set.');
  }

  const pool = new Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    return await backfillTyreMeasurements(prisma, options);
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
  runBackfillTyreMeasurementsCli()
    .then((summary) => {
      const mode = process.argv.includes('--execute') ? 'execute' : 'dry-run';
      console.log(`${mode}: ${JSON.stringify(summary, null, 2)}`);
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error(
        error instanceof Error ? error.message : `Unexpected error: ${String(error)}`,
      );
      process.exit(1);
    });
}
