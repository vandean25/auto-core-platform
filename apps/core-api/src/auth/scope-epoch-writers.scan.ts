import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGISTERED_SCOPE_EPOCH_WRITER_PATHS } from './scope-epoch-writers.inventory.js';

const API_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCAN_ROOTS = [join(API_ROOT, 'src'), join(API_ROOT, 'scripts')];

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

const TX_EPOCH_DELEGATE_CALLS = [
  'reactivateSiteMembershipWithMemberEpoch',
  'createActiveSiteMembershipWithMemberEpoch',
  'upsertActiveTenantMemberWithMemberEpoch',
] as const;

const ATOMICITY_EXEMPT_PATHS = new Set(['prisma/fixtures/clean-db.ts']);

const TRANSACTION_CALLBACK =
  /\$transaction\s*\(\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/g;

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
  if (
    ACTIVATION_STATUS_WRITE.test(source) &&
    ENTITY_UPDATE_WRITE.test(source)
  ) {
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

function hasMembershipAccessWrite(bounded: string): boolean {
  return /\b(?:tx\.)?(?:tenantMember|siteMembership)\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(/.test(
    bounded,
  );
}

const ENTITY_UPDATE_UPSERT =
  /\b(?:tx\.)?(?:tenant|site|legalEntity)\.(?:update|upsert)\(/;
const ENTITY_UPDATE_MANY =
  /\b(?:tx\.)?(?:tenant|site|legalEntity)\.updateMany\(/;
const IS_ACTIVE_LITERAL = /is_active:\s*(?:true|false)/;
const IS_ACTIVE_DTO_FIELD = /is_active:\s*dto\.isActive/;

function entityBlockTouchesIsActive(bounded: string): boolean {
  const hasEntityUpdate = ENTITY_UPDATE_UPSERT.test(bounded);
  const hasEntityUpdateMany = ENTITY_UPDATE_MANY.test(bounded);
  if (!hasEntityUpdate && !hasEntityUpdateMany) {
    return false;
  }
  if (
    hasEntityUpdateMany &&
    !hasEntityUpdate &&
    !/is_active:\s*false/.test(bounded)
  ) {
    // Row-lock no-ops use updateMany({ data: { is_active: true } }) without changing access.
    return false;
  }
  return true;
}

function entityBlockAssignsIsActive(bounded: string): boolean {
  if (IS_ACTIVE_LITERAL.test(bounded) || IS_ACTIVE_DTO_FIELD.test(bounded)) {
    return true;
  }
  const siteUpdateData =
    /\b(?:tx\.)?site\.update\(/.test(bounded) &&
    /updateData/.test(bounded) &&
    /is_active/.test(bounded);
  const legalEntityDto =
    /\b(?:tx\.)?legalEntity\.update\(/.test(bounded) &&
    /dto\.isActive/.test(bounded);
  const tenantDto =
    /\b(?:tx\.)?tenant\.update\(/.test(bounded) &&
    /dto\.isActive/.test(bounded);
  return siteUpdateData || legalEntityDto || tenantDto;
}

/** ADR-0038 §2: tenant/site/legalEntity updates that assign is_active count as access writes. */
function hasEntityIsActiveAccessWrite(bounded: string): boolean {
  return (
    entityBlockTouchesIsActive(bounded) && entityBlockAssignsIsActive(bounded)
  );
}

function transactionBlockRequiresEpoch(bounded: string): boolean {
  return (
    hasMembershipAccessWrite(bounded) || hasEntityIsActiveAccessWrite(bounded)
  );
}

function sliceBalancedBraces(
  source: string,
  openBraceIndex: number,
): string | null {
  let depth = 0;
  let inString: '"' | "'" | '`' | null = null;
  let escaped = false;
  for (let i = openBraceIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '{') {
      depth += 1;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openBraceIndex + 1, i);
      }
    }
  }
  return null;
}

/** Extracts arrow-callback bodies for `prisma.$transaction(async (tx) => { ... })`. */
export function extractTransactionCallbackBodies(source: string): string[] {
  const bodies: string[] = [];
  TRANSACTION_CALLBACK.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TRANSACTION_CALLBACK.exec(source)) !== null) {
    const openBraceIndex = match.index + match[0].length - 1;
    const body = sliceBalancedBraces(source, openBraceIndex);
    if (body !== null) {
      bodies.push(body);
    }
  }
  return bodies;
}

function callbackBumpsEpochOnSameTx(callbackBody: string): boolean {
  if (/\badvanceScopeEpoch\s*\(\s*tx\b/.test(callbackBody)) {
    return true;
  }
  return TX_EPOCH_DELEGATE_CALLS.some((name) =>
    new RegExp(`\\b${name}\\s*\\(\\s*tx\\b`).test(callbackBody),
  );
}

export function transactionBlocksMissingEpoch(source: string): string[] {
  const violations: string[] = [];
  const bodies = extractTransactionCallbackBodies(source);
  for (let index = 0; index < bodies.length; index += 1) {
    const bounded = bodies[index] ?? '';
    if (!transactionBlockRequiresEpoch(bounded)) {
      continue;
    }
    if (!callbackBumpsEpochOnSameTx(bounded)) {
      violations.push(`$transaction block ${index + 1}`);
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

    const blocks = transactionBlocksMissingEpoch(readFileSync(file, 'utf8'));
    if (blocks.length > 0) {
      violations.push({ path, blocks });
    }
  }

  return violations;
}
