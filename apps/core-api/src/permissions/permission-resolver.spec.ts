import { describe, expect, it, jest } from '@jest/globals';
import { MCP_TOOL_TABLE, OPERATION_TABLE } from './operation-table.js';
import type { LegacyRole, ProtectedOperation } from './operation-types.js';
import {
  PermissionResolver,
  isMcpToolAllowed,
  isOperationAllowed,
  legacyAccess,
} from './permission-resolver.js';

const PRINCIPAL = { userId: 'firebase-uid-1', tenantId: 'tenant-1' };

function resolverFor(membership: object | null) {
  const findFirst = jest
    .fn<(args: object) => Promise<object | null>>()
    .mockResolvedValue(membership);
  const resolver = new PermissionResolver({
    tenantMember: { findFirst },
  } as never);
  return { resolver, findFirst };
}

describe('permission resolver (legacy adapter)', () => {
  // Scenario 3: the DEMO mask is applied after the permission union.
  it('denies a DEMO member a write outside the permitted demo writes, also if the permission is mapped to ADMIN', () => {
    const removeLocation = OPERATION_TABLE[
      'LocationController.remove'
    ] as ProtectedOperation;
    const request = { method: 'DELETE', path: '/api/inventory/locations/x' };

    // DEMO holds stock.location.manage through the permitted create/update writes.
    expect(legacyAccess('DEMO').permissions.has('stock.location.manage')).toBe(
      true,
    );
    expect(isOperationAllowed(removeLocation, legacyAccess('ADMIN'), request)).toBe(
      true,
    );
    expect(isOperationAllowed(removeLocation, legacyAccess('DEMO'), request)).toBe(
      false,
    );
  });

  // Request-local snapshot: one membership query per request, none shared across requests.
  it('queries the membership once per request however many permission checks follow', async () => {
    const { resolver, findFirst } = resolverFor({
      role: 'SALES',
      demo_access_expires_at: null,
    });
    const request = {};

    const accesses = await Promise.all(
      Array.from({ length: 25 }, () => resolver.resolve(request, PRINCIPAL)),
    );

    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenant_id: 'tenant-1',
          is_active: true,
        }) as object,
      }),
    );
    expect(
      accesses.every(
        (access) =>
          access?.role === 'SALES' && access.permissions.has('customer.read'),
      ),
    ).toBe(true);

    await resolver.resolve({}, PRINCIPAL);
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['no active membership in the tenant', null],
    [
      'an expired demo membership',
      { role: 'DEMO', demo_access_expires_at: new Date(Date.now() - 1000) },
    ],
  ])('resolves no access for %s', async (_label, membership) => {
    const { resolver } = resolverFor(membership);

    await expect(resolver.resolve({}, PRINCIPAL)).resolves.toBeNull();
  });

  // Fail closed: nothing grants a permission outside the catalogue, and an unknown MCP tool is never allowed.
  it.each([
    ['an unknown permission identifier', () => isOperationAllowed(
      { ...(OPERATION_TABLE['CustomerController.findAll'] as ProtectedOperation), permissions: ['customer.reed' as never] },
      legacyAccess('OWNER'),
      { method: 'GET', path: '/api/customers' },
    )],
    ['an unknown MCP tool name', () => isMcpToolAllowed('drop_all_tables', legacyAccess('OWNER'))],
    ['an MCP tool without a member', () => isMcpToolAllowed('search_customers', null)],
  ])('denies %s', (_label, decide) => {
    expect(decide()).toBe(false);
  });

  const PROTECTED_ENTRIES = [
    ...Object.entries(OPERATION_TABLE),
    ...Object.entries(MCP_TOOL_TABLE),
  ].flatMap(([id, entry]) => (entry.kind === 'protected' ? [[id, entry] as const] : []));

  // One permission, one legacy role set: otherwise the role->permission union widens the narrower operation.
  // DEMO is left out: it is a baseline whose requests the mask decides.
  it('maps every permission to exactly one legacy role set', () => {
    const sets = new Map<string, Set<string>>();
    for (const [, entry] of PROTECTED_ENTRIES) {
      const roles = entry.legacy.filter((role) => role !== 'DEMO').sort().join(',');
      for (const permission of entry.permissions) {
        sets.set(permission, (sets.get(permission) ?? new Set()).add(roles));
      }
    }

    expect(
      [...sets].filter(([, roles]) => roles.size > 1).map(([permission, roles]) => `${permission}: ${[...roles].join(' | ')}`),
    ).toEqual([]);
  });

  // The permission model must reproduce the recorded role set of every protected operation, DEMO mask aside.
  it('grants each role exactly the protected operations whose recorded legacy role set lists it', () => {
    const roles: LegacyRole[] = ['OWNER', 'ADMIN', 'TECH', 'SALES'];
    const mismatches = PROTECTED_ENTRIES.flatMap(([id, entry]) =>
      roles.filter(
        (role) =>
          isOperationAllowed(entry, legacyAccess(role), { method: 'GET', path: '/api/x' }) !==
          entry.legacy.includes(role),
      ).map((role) => `${role} on ${id}`),
    );

    expect(mismatches).toEqual([]);
  });
});
