import { createHash } from 'node:crypto';
import {
  DEMO_MUTATION_ALLOWED_EXACT,
  DEMO_MUTATION_ALLOWED_PREFIXES,
  DEMO_MUTATION_BLOCKED_PREFIXES,
  DEMO_MUTATION_BLOCKED_SUBSTRINGS,
} from '../../landing-demo-access/demo-role-restrictions.js';
import { PERMISSION_CATALOGUE_VERSION } from '../../permissions/permission-catalogue.js';
import { OPERATION_TABLE } from '../../permissions/operation-table.js';
import type { OperationEntry } from '../../permissions/operation-types.js';
import { SCOPE_CONTEXT_POLICY_OPERATION_IDS } from './scope-context.constants.js';

function stableOperationRecord(entry: OperationEntry): Record<string, unknown> {
  if (entry.kind === 'protected') {
    return {
      kind: entry.kind,
      permissions: [...entry.permissions].sort(),
      legacy: [...entry.legacy].sort(),
      scope: entry.scope,
      checks: [...entry.checks].sort(),
      principals: [...entry.principals].sort(),
    };
  }
  if (entry.kind === 'api_key') {
    return {
      kind: entry.kind,
      policy: entry.policy,
      apiKeyScope: entry.apiKeyScope,
      permissions: [...entry.permissions].sort(),
      legacy: [...entry.legacy].sort(),
    };
  }
  return {
    kind: entry.kind,
    policy: entry.policy,
    legacy: entry.legacy ? [...entry.legacy].sort() : undefined,
    withoutRole: entry.withoutRole,
  };
}

export function computeScopeContextPolicyDigest(): string {
  const operations = SCOPE_CONTEXT_POLICY_OPERATION_IDS.map((id) => {
    const entry = OPERATION_TABLE[id];
    if (!entry) {
      throw new Error(`Missing operation table entry for policy digest: ${id}`);
    }
    return { id, operation: stableOperationRecord(entry) };
  });

  const demoMask = {
    allowedExact: [...DEMO_MUTATION_ALLOWED_EXACT].sort(),
    allowedPrefixes: [...DEMO_MUTATION_ALLOWED_PREFIXES].sort(),
    blockedPrefixes: [...DEMO_MUTATION_BLOCKED_PREFIXES].sort(),
    blockedSubstrings: [...DEMO_MUTATION_BLOCKED_SUBSTRINGS].sort(),
  };

  const payload = {
    catalogueVersion: PERMISSION_CATALOGUE_VERSION,
    operations,
    demoMask,
  };

  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

let cachedPolicyDigest: string | undefined;

export function getScopeContextPolicyDigest(): string {
  cachedPolicyDigest ??= computeScopeContextPolicyDigest();
  return cachedPolicyDigest;
}

/** Test helper to reset the boot-time cache. */
export function resetScopeContextPolicyDigestCacheForTests(): void {
  cachedPolicyDigest = undefined;
}
