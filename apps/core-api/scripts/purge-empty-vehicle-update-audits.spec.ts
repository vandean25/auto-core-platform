import {
  isEmptyVehicleUpdateChangedFields,
  parsePurgeEmptyVehicleUpdateAuditsArgv,
  purgeEmptyVehicleUpdateAudits,
  runPurgeEmptyVehicleUpdateAuditsCli,
  type EmptyVehicleUpdateAuditStore,
} from './purge-empty-vehicle-update-audits.js';

function storeFrom(rows: { id: string; changed_fields: unknown }[]): EmptyVehicleUpdateAuditStore & {
  deleted: string[];
} {
  const remaining = [...rows];
  const deleted: string[] = [];
  return {
    deleted,
    auditLog: {
      findMany: async ({ where, take }) => {
        const slice = remaining.filter(
          (row) => !where.id?.gt || row.id > where.id.gt,
        );
        return slice.slice(0, take);
      },
      deleteMany: async ({ where }) => {
        const ids = new Set(where.id.in);
        for (const id of ids) {
          deleted.push(id);
        }
        return { count: ids.size };
      },
    },
  };
}

describe('purge-empty-vehicle-update-audits', () => {
  it('treats an empty list and bookkeeping-only fields as empty', () => {
    expect(isEmptyVehicleUpdateChangedFields([])).toBe(true);
    expect(isEmptyVehicleUpdateChangedFields(['updatedAt'])).toBe(true);
    expect(isEmptyVehicleUpdateChangedFields(['version', 'updatedAt'])).toBe(true);
    expect(isEmptyVehicleUpdateChangedFields(['make'])).toBe(false);
    expect(isEmptyVehicleUpdateChangedFields(null)).toBe(false);
  });

  it('defaults to dry-run and accepts --execute', () => {
    expect(parsePurgeEmptyVehicleUpdateAuditsArgv(['node', 'script.ts'])).toEqual({
      execute: false,
    });
    expect(
      parsePurgeEmptyVehicleUpdateAuditsArgv(['node', 'script.ts', '--dry-run']),
    ).toEqual({ execute: false });
    expect(
      parsePurgeEmptyVehicleUpdateAuditsArgv(['node', 'script.ts', '--execute']),
    ).toEqual({ execute: true });
  });

  it('refuses both flags', () => {
    expect(() =>
      parsePurgeEmptyVehicleUpdateAuditsArgv([
        'node',
        'script.ts',
        '--dry-run',
        '--execute',
      ]),
    ).toThrow('--dry-run');
  });

  it('dry-run counts empty rows and deletes nothing', async () => {
    const store = storeFrom([
      { id: 'a', changed_fields: [] },
      { id: 'b', changed_fields: ['updatedAt'] },
      { id: 'c', changed_fields: ['plate'] },
    ]);

    const result = await purgeEmptyVehicleUpdateAudits(store, { execute: false });

    expect(result).toEqual({ matched: 2, deleted: 0 });
    expect(store.deleted).toEqual([]);
  });

  it('execute deletes only empty rows, including a second batch', async () => {
    const rows = Array.from({ length: 5_001 }, (_, index) => ({
      id: String(index).padStart(5, '0'),
      changed_fields: index % 2 === 0 ? [] : ['make'],
    }));
    const store = storeFrom(rows);

    const result = await runPurgeEmptyVehicleUpdateAuditsCli(
      ['node', 'script.ts', '--execute'],
      store,
    );

    expect(result.matched).toBe(2501);
    expect(result.deleted).toBe(2501);
    expect(store.deleted).toHaveLength(2501);
  });
});
