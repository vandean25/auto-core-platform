import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const scriptPath = path.resolve(
  import.meta.dirname,
  'export-tenant-data.sh',
);
const tenantId = '11111111-1111-4111-8111-111111111111';

function createFakeCommandDirectory(markerPath) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-restore-'));
  for (const command of ['psql', 'pg_dump']) {
    const commandPath = path.join(directory, command);
    fs.writeFileSync(
      commandPath,
      `#!/usr/bin/env bash
printf '%s\n' "${command}" >> "$FAKE_COMMAND_MARKER"
`,
      { mode: 0o755 },
    );
  }
  return { directory, markerPath };
}

function runExport(args, environment) {
  return spawnSync('bash', [scriptPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...environment },
  });
}

test('requires an exact confirmation tenant id', () => {
  const markerPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-restore-marker-')),
    'commands.log',
  );
  const fakeCommands = createFakeCommandDirectory(markerPath);
  const result = runExport(
    ['postgresql://localhost/clone', tenantId, '/tmp/tenant.sql'],
    {
      PATH: `${fakeCommands.directory}:${process.env.PATH}`,
      FAKE_COMMAND_MARKER: markerPath,
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /CONFIRM_TENANT_ID/);
  assert.equal(fs.existsSync(markerPath), false);
});

test('rejects Neon pooler URLs before any database command', () => {
  const markerPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-restore-marker-')),
    'commands.log',
  );
  const fakeCommands = createFakeCommandDirectory(markerPath);
  const result = runExport(
    [
      'postgresql://ep-example-pooler.eu-central-1.aws.neon.tech/clone',
      tenantId,
      '/tmp/tenant.sql',
    ],
    {
      PATH: `${fakeCommands.directory}:${process.env.PATH}`,
      FAKE_COMMAND_MARKER: markerPath,
      CONFIRM_TENANT_ID: tenantId,
      I_UNDERSTAND_CROSS_TENANT_BLAST_RADIUS: 'yes',
      DRY_RUN: '0',
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /pooler/);
  assert.equal(fs.existsSync(markerPath), false);
});

test('defaults to dry-run and does not invoke database commands', () => {
  const markerPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-restore-marker-')),
    'commands.log',
  );
  const fakeCommands = createFakeCommandDirectory(markerPath);
  const result = runExport(
    ['postgresql://localhost/clone', tenantId, '/tmp/tenant.sql'],
    {
      PATH: `${fakeCommands.directory}:${process.env.PATH}`,
      FAKE_COMMAND_MARKER: markerPath,
      CONFIRM_TENANT_ID: tenantId,
    },
  );

  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.match(`${result.stdout}${result.stderr}`, /DRY_RUN=1/);
  assert.equal(fs.existsSync(markerPath), false);
});
