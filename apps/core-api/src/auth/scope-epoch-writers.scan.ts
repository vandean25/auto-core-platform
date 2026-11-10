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
const ENTITY_UPDATE_WRITE =
  /\b(?:tenant|site|legalEntity)\.(?:update|updateMany)\(/;
const TENANT_UPSERT_REACTIVATION =
  /\btenant\.upsert\(\{[\s\S]*?update:\s*\{[^}]*is_active:\s*true/;
const SITE_UPSERT_ACTIVATION =
  /\bsite\.upsert\(\{[\s\S]*?(?:update|create):\s*\{[^}]*is_active:\s*true/;
const LEGAL_ENTITY_UPSERT_ACTIVATION =
  /\blegalEntity\.upsert\(\{[\s\S]*?(?:update|create):\s*\{[^}]*is_active:\s*true/;
const RAW_TENANT_MEMBER_WRITE =
  /\b(?:UPDATE|INSERT INTO|DELETE FROM)\s+["']?tenant_members["']?/gi;
const RAW_SITE_MEMBERSHIP_WRITE =
  /\b(?:UPDATE|INSERT INTO|DELETE FROM)\s+["']?site_memberships["']?/gi;
const RAW_TENANT_ACTIVATION_WRITE =
  /\bUPDATE\s+["']?tenants["']?[\s\S]*?\bis_active\b/gi;

const EPOCH_DELEGATE_CALLS = [
  'ensureActiveSiteMembershipWithMemberEpoch',
  'reactivateSiteMembershipWithMemberEpoch',
  'createActiveSiteMembershipWithMemberEpoch',
  'upsertActiveTenantMemberWithMemberEpoch',
] as const;

const ATOMICITY_EXEMPT_PATHS = new Set([
  'auth/scope-epoch-access-writes.ts',
  'prisma/fixtures/clean-db.ts',
]);

export function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

export function relativeWriterPath(absolutePath: string): string {
  const fromSrc = relative(join(API_ROOT, 'src'), absolutePath);
  if (!fromSrc.startsWith('..')) {
    return fromSrc;
  }
  return relative(API_ROOT, absolutePath);
}

export function isScannedSourcePath(name: string): boolean {
  return (
    name.endsWith('.ts') &&
    !/\.spec(\.support)?\.ts$/.test(name) &&
    !name.endsWith('.test.ts') &&
    name !== 'auth/scope-epoch-writers.spec.ts' &&
    name !== 'auth/scope-epoch-writers.scan.ts' &&
    name !== 'auth/scope-epoch-writers.inventory.ts' &&
    name !== 'auth/scope-epoch.ts'
  );
}

function isScanned(file: string): boolean {
  return isScannedSourcePath(relativeWriterPath(file));
}

export function countAccessWrites(source: string): number {
  const memberWrites =
    [...source.matchAll(TENANT_MEMBER_WRITE)].length +
    [...source.matchAll(SITE_MEMBERSHIP_WRITE)].length;
  const rawWrites =
    [...source.matchAll(RAW_TENANT_MEMBER_WRITE)].length +
    [...source.matchAll(RAW_SITE_MEMBERSHIP_WRITE)].length +
    [...source.matchAll(RAW_TENANT_ACTIVATION_WRITE)].length;
  let activationWrites = 0;
  if (ACTIVATION_STATUS_WRITE.test(source) && ENTITY_UPDATE_WRITE.test(source)) {
    activationWrites += 1;
  }
  if (TENANT_UPSERT_REACTIVATION.test(source)) {
    activationWrites += 1;
  }
  if (SITE_UPSERT_ACTIVATION.test(source)) {
    activationWrites += 1;
  }
  if (LEGAL_ENTITY_UPSERT_ACTIVATION.test(source)) {
    activationWrites += 1;
  }
  return memberWrites + rawWrites + activationWrites;
}

export function transactionBlocksMissingEpoch(source: string): string[] {
  const violations: string[] = [];
  const parts = source.split('$transaction');
  for (let index = 1; index < parts.length; index += 1) {
    const block = parts[index] ?? '';
    const bounded = block.slice(0, 4000);
    const hasMembershipWrite =
      /\b(?:tx\.)?(?:tenantMember|siteMembership)\.(?:create|update|updateMany|upsert|delete|deleteMany)\(/.test(
        bounded,
      );
    const hasTenantActivation =
      /\b(?:tx\.)?tenant\.(?:update|updateMany|upsert)\(/.test(bounded) &&
      /is_active:\s*true/.test(bounded);
    if (!hasMembershipWrite && !hasTenantActivation) {
      continue;
    }
    const bumpsEpoch = bounded.includes('advanceScopeEpoch');
    const delegatesEpoch = EPOCH_DELEGATE_CALLS.some((name) =>
      bounded.includes(name),
    );
    if (!bumpsEpoch && !delegatesEpoch) {
      violations.push(`$transaction block ${index}`);
    }
  }
  return violations;
}

export function listDetectedScopeEpochWriters(): string[] {
  return SCAN_ROOTS.flatMap(sourceFiles)
    .filter(isScanned)
    .filter((file) => countAccessWrites(readFileSync(file, 'utf8')) > 0)
    .map(relativeWriterPath)
    .sort();
}

export function listScopeEpochAtomicityViolations(): {
  path: string;
  blocks: string[];
}[] {
  const violations: { path: string; blocks: string[] }[] = [];

  for (const file of SCAN_ROOTS.flatMap(sourceFiles).filter(isScanned)) {
    const path = relativeWriterPath(file);
    if (!REGISTERED_SCOPE_EPOCH_WRITER_PATHS.includes(path as never)) {
      continue;
    }
    if (ATOMICITY_EXEMPT_PATHS.has(path)) {
      continue;
    }

    const blocks = transactionBlocksMissingEpoch(
      readFileSync(file, 'utf8'),
    );
    if (blocks.length > 0) {
      violations.push({ path, blocks });
    }
  }

  return violations;
}
