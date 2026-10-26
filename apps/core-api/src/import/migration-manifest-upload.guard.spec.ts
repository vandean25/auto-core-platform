import { BadRequestException } from '@nestjs/common';
import type { Express } from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertCanonicalMigrationUploadAllowed } from './migration-manifest-upload.guard.js';
import { parseMigrationManifestJson } from './migration-manifest.validator.js';
import { MIGRATION_MANIFEST_ERROR_CODES } from './migration-manifest.errors.js';
import { sha256Buffer } from './migration-csv-parse.util.js';
import { parseCsvBufferHeadersOnly } from './import-csv-batch.util.js';

const fixtureDir = join(process.cwd(), 'test/fixtures/migration-csv-v1');

describe('assertCanonicalMigrationUploadAllowed', () => {
  it('validates staged uploads from assessed stats without a full file buffer', () => {
    const customers = readFileSync(join(fixtureDir, 'customers.csv'));
    const manifest = parseMigrationManifestJson(
      readFileSync(join(fixtureDir, 'manifest.json')),
    );
    manifest.control_totals.stock_value = '100.00';
    const headerStats = parseCsvBufferHeadersOnly(customers);
    const file = {
      originalname: 'customers.csv',
      buffer: undefined,
    } as unknown as Express.Multer.File;

    expect(() =>
      assertCanonicalMigrationUploadAllowed(file, manifest, {
        sha256: sha256Buffer(customers),
        dataRowCount: headerStats.dataRowCount,
      }),
    ).toThrow(BadRequestException);

    try {
      assertCanonicalMigrationUploadAllowed(file, manifest, {
        sha256: sha256Buffer(customers),
        dataRowCount: headerStats.dataRowCount,
      });
    } catch (error) {
      const body = (error as BadRequestException).getResponse() as {
        issues: Array<{ code: string }>;
      };
      expect(
        body.issues.some(
          (issue) =>
            issue.code ===
            MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_CONTROL_TOTAL_NOT_RECONCILED,
        ),
      ).toBe(true);
    }
  });
});
