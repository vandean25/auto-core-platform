import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { enableLegacyMigrationPurgeFlag } from './legacy-migration-purge-flag.js';

const databaseUrl = process.env.DATABASE_URL;

describe('enableLegacyMigrationPurgeFlag', () => {
  it('sets transaction-local allow_purge on a real Prisma transaction client', async () => {
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required for legacy-migration-purge-flag.spec.ts');
    }

    const pool = new Pool({ connectionString: databaseUrl });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    await prisma.$connect();

    try {
      await prisma.$transaction(async (tx) => {
        await enableLegacyMigrationPurgeFlag(tx);
        const queryRaw = tx['$queryRaw'].bind(tx) as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<Array<{ value: string | null }>>;
        const rows = await queryRaw`
          SELECT current_setting('acp.allow_purge', true) AS value
        `;
        expect(rows[0]?.value).toBe('on');
      });
    } finally {
      await prisma.$disconnect();
      await pool.end();
    }
  });
});
