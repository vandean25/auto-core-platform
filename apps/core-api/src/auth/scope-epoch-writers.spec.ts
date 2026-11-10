import { REGISTERED_SCOPE_EPOCH_WRITER_PATHS } from './scope-epoch-writers.inventory.js';
import {
  countAccessWrites,
  isScannedSourcePath,
  listDetectedScopeEpochWriters,
  listScopeEpochAtomicityViolations,
  transactionBlocksMissingEpoch,
} from './scope-epoch-writers.scan.js';

describe('scope-epoch-writers scan helpers', () => {
  it('excludes specs and inventory from source scan paths', () => {
    expect(isScannedSourcePath('auth/scope-epoch-writers.spec.ts')).toBe(false);
    expect(isScannedSourcePath('auth/scope-epoch-writers.scan.ts')).toBe(false);
    expect(isScannedSourcePath('tenant-member/tenant-member.service.ts')).toBe(
      true,
    );
  });

  it('counts tenant upsert reactivation as an activation write', () => {
    const source = `
      await tx.tenant.upsert({
        update: { is_active: true },
        create: { name: 'x' },
      });
    `;
    expect(countAccessWrites(source)).toBeGreaterThanOrEqual(1);
  });

  it('flags membership transaction blocks without epoch bumps', () => {
    const missingBump = `
      await prisma.$transaction(async (tx) => {
        await tx.siteMembership.create({ data: {} });
      });
    `;
    const withBump = `
      await prisma.$transaction(async (tx) => {
        await tx.siteMembership.create({ data: {} });
        await advanceScopeEpoch(tx, { kind: 'member' });
      });
    `;

    expect(transactionBlocksMissingEpoch(missingBump)).toEqual([
      '$transaction block 1',
    ]);
    expect(transactionBlocksMissingEpoch(withBump)).toEqual([]);
  });

  it('accepts delegated epoch helpers inside transaction blocks', () => {
    const source = `
      await prisma.$transaction(async (tx) => {
        await ensureActiveSiteMembershipWithMemberEpoch(prisma, {});
      });
    `;
    expect(transactionBlocksMissingEpoch(source)).toEqual([]);
  });

  it('flags legal entity is_active deactivation without epoch bump', () => {
    const missingBump = `
      await prisma.$transaction(async (tx) => {
        await tx.legalEntity.update({
          where: { id },
          data: { is_active: false },
        });
      });
    `;
    expect(transactionBlocksMissingEpoch(missingBump)).toEqual([
      '$transaction block 1',
    ]);
  });

  it('flags legal entity dto.isActive updates without epoch bump', () => {
    const missingBump = `
      await prisma.$transaction(async (tx) => {
        await tx.legalEntity.update({ where: { id }, data: profile });
        if (dto.isActive !== undefined && dto.isActive !== existing.is_active) {
        }
      });
    `;
    expect(transactionBlocksMissingEpoch(missingBump)).toEqual([
      '$transaction block 1',
    ]);
  });

  it('flags site updateData is_active changes without epoch bump', () => {
    const missingBump = `
      await prisma.$transaction(async (tx) => {
        const row = await tx.site.update({ where: { id }, data: updateData });
        if (updateData.is_active !== existing.is_active) {
        }
      });
    `;
    expect(transactionBlocksMissingEpoch(missingBump)).toEqual([
      '$transaction block 1',
    ]);
  });

  it('flags platform tenant dto.isActive updates without epoch bump', () => {
    const missingBump = `
      await prisma.$transaction(async (tx) => {
        await tx.tenant.update({
          where: { id },
          data: { ...(dto.isActive !== undefined && { is_active: dto.isActive }) },
        });
        if (dto.isActive !== undefined) {
        }
      });
    `;
    expect(transactionBlocksMissingEpoch(missingBump)).toEqual([
      '$transaction block 1',
    ]);
  });
});

describe('scope-epoch-writers inventory', () => {
  it('unregistered writer fails', () => {
    expect(listDetectedScopeEpochWriters()).toEqual(
      [...REGISTERED_SCOPE_EPOCH_WRITER_PATHS].sort(),
    );
  });

  it('access writes bump epoch in the same transaction', () => {
    expect(listScopeEpochAtomicityViolations()).toEqual([]);
  });
});
