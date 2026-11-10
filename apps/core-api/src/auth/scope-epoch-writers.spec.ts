import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGISTERED_SCOPE_EPOCH_WRITER_PATHS } from './scope-epoch-writers.inventory.js';

const API_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCAN_ROOTS = [
  join(API_ROOT, 'src'),
  join(API_ROOT, 'scripts'),
];

const TENANT_MEMBER_WRITE =
  /\btenantMember\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g;
const SITE_MEMBERSHIP_WRITE =
  /\bsiteMembership\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g;
const ACTIVATION_STATUS_WRITE =
  /is_active:\s*dto\.isActive|is_active:\s*false|buildSiteUpdateData/;
const RAW_TENANT_MEMBER_WRITE =
  /\b(?:UPDATE|INSERT INTO|DELETE FROM)\s+["']?tenant_members["']?/gi;
const RAW_SITE_MEMBERSHIP_WRITE =
  /\b(?:UPDATE|INSERT INTO|DELETE FROM)\s+["']?site_memberships["']?/gi;
const RAW_TENANT_ACTIVATION_WRITE =
  /\bUPDATE\s+["']?tenants["']?[\s\S]*?\bis_active\b/gi;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

function relativeWriterPath(absolutePath: string): string {
  const fromSrc = relative(join(API_ROOT, 'src'), absolutePath);
  if (!fromSrc.startsWith('..')) {
    return fromSrc;
  }
  return relative(API_ROOT, absolutePath);
}

function isScanned(file: string): boolean {
  const name = relativeWriterPath(file);
  return (
    name.endsWith('.ts') &&
    !/\.spec(\.support)?\.ts$/.test(name) &&
    !name.endsWith('.test.ts') &&
    name !== 'auth/scope-epoch-writers.spec.ts' &&
    name !== 'auth/scope-epoch-writers.inventory.ts' &&
    name !== 'auth/scope-epoch.ts'
  );
}

function countAccessWrites(source: string): number {
  const memberWrites =
    [...source.matchAll(TENANT_MEMBER_WRITE)].length +
    [...source.matchAll(SITE_MEMBERSHIP_WRITE)].length;
  const rawWrites =
    [...source.matchAll(RAW_TENANT_MEMBER_WRITE)].length +
    [...source.matchAll(RAW_SITE_MEMBERSHIP_WRITE)].length +
    [...source.matchAll(RAW_TENANT_ACTIVATION_WRITE)].length;
  const activationWrites =
    ACTIVATION_STATUS_WRITE.test(source) &&
    /\b(?:tenant|site|legalEntity)\.update(?:Many)?\(/.test(source)
      ? 1
      : 0;
  return memberWrites + rawWrites + activationWrites;
}

describe('scope-epoch-writers', () => {
  it('unregistered writer fails', () => {
    const writers = SCAN_ROOTS.flatMap(sourceFiles)
      .filter(isScanned)
      .filter((file) => countAccessWrites(readFileSync(file, 'utf8')) > 0)
      .map(relativeWriterPath)
      .sort();

    expect(writers).toEqual([...REGISTERED_SCOPE_EPOCH_WRITER_PATHS].sort());
  });
});
