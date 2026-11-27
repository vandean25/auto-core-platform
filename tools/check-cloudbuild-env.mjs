#!/usr/bin/env node
/**
 * CI check (AUT-1061): verify every boot-required core-api env key in
 * apps/core-api/src/config/env.ts is mounted in cloudbuild.yaml (QA)
 * and cloudbuild.staging.yaml (production).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { checkCloudBuildEnv, DEFAULT_ALLOWLIST } from './check-cloudbuild-env-lib.mjs';

const VALUE_FLAGS = { '--env': 'envPath', '--qa': 'qaPath', '--prod': 'prodPath' };

function parseArgs(argv) {
  const opts = {
    envPath: path.join('apps', 'core-api', 'src', 'config', 'env.ts'),
    qaPath: 'cloudbuild.yaml',
    prodPath: 'cloudbuild.staging.yaml',
    useDefaultAllowlist: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const targetKey = VALUE_FLAGS[arg];
    if (targetKey && argv[i + 1]) {
      opts[targetKey] = argv[++i];
    } else if (arg === '--no-default-allowlist') {
      opts.useDefaultAllowlist = false;
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node tools/check-cloudbuild-env.mjs [--env <path>] [--qa <path>] [--prod <path>]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const result = checkCloudBuildEnv({
  envTsSource: readFileSync(opts.envPath, 'utf8'),
  targets: [
    { file: path.basename(opts.qaPath), content: readFileSync(opts.qaPath, 'utf8') },
    { file: path.basename(opts.prodPath), content: readFileSync(opts.prodPath, 'utf8') },
  ],
  allowlist: opts.useDefaultAllowlist ? DEFAULT_ALLOWLIST : [],
});

for (const warning of result.warnings) {
  console.warn(`WARN: ${warning}`);
}
for (const error of result.errors) {
  console.error(`ERROR: ${error}`);
}

if (!result.ok) {
  process.exitCode = 1;
} else {
  console.log('Cloud Build env check passed.');
}
