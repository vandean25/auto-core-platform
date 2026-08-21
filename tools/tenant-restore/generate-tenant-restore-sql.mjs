#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  buildTenantRestoreManifest,
  renderPurgeSql,
  renderSchemaCheckSql,
} from './tenant-schema.mjs';

const scriptDirectory = import.meta.dirname;
const schemaPath = path.resolve(
  scriptDirectory,
  '../../apps/core-api/prisma/schema.prisma',
);
const outputDirectory = scriptDirectory;

const schema = fs.readFileSync(schemaPath, 'utf8');
const manifest = buildTenantRestoreManifest(schema);

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
