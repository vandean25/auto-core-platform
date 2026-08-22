#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  buildTenantRestoreManifestFromFiles,
  renderPurgeSql,
  renderSchemaCheckSql,
} from './tenant-schema.mjs';

const scriptDirectory = import.meta.dirname;
const schemaPath = path.resolve(
  scriptDirectory,
  '../../apps/core-api/prisma/schema.prisma',
);
const migrationsDirectory = path.resolve(
  scriptDirectory,
  '../../apps/core-api/prisma/migrations',
);
const manifest = buildTenantRestoreManifestFromFiles(
  schemaPath,
  migrationsDirectory,
);
const expectedFiles = new Map([
  ['purge-tenant-data.sql', renderPurgeSql(manifest)],
  ['verify-tenant-schema.sql', renderSchemaCheckSql(manifest)],
]);

const mismatches = [];
for (const [fileName, expected] of expectedFiles) {
  const filePath = path.join(scriptDirectory, fileName);
  const actual = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, 'utf8')
    : null;
  if (actual !== expected) mismatches.push(fileName);
}

if (mismatches.length > 0) {
  process.stderr.write(
    `Tenant restore generated files are stale: ${mismatches.join(', ')}\n` +
      'Run node tools/tenant-restore/generate-tenant-restore-sql.mjs and commit the result.\n',
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Tenant restore table list is current (${manifest.tables.length} tables).\n`,
  );
}
