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
const outputDirectory = scriptDirectory;

const manifest = buildTenantRestoreManifestFromFiles(
  schemaPath,
  migrationsDirectory,
);

fs.writeFileSync(
  path.join(outputDirectory, 'purge-tenant-data.sql'),
  renderPurgeSql(manifest),
);
fs.writeFileSync(
  path.join(outputDirectory, 'verify-tenant-schema.sql'),
  renderSchemaCheckSql(manifest),
);

process.stdout.write(
  `Generated ${manifest.tables.length} tenant restore tables from ${schemaPath}\n`,
);
