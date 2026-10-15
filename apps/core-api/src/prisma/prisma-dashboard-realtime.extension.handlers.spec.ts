import { DryRunChangeCollector } from '../dry-run/dry-run-change-collector.js';
import { DryRunStorage } from '../dry-run/dry-run.storage.js';
import {
  TENANT_ID,
  buildAllModelsHandlers,
  runWithTenant,
} from './prisma-dashboard-realtime.spec.support.js';

const MUTATIONS = [
  ['create', 'CREATED'],
  ['update', 'UPDATED'],
  ['updateMany', 'UPDATED'],
  ['delete', 'DELETED'],
  ['deleteMany', 'DELETED'],
] as const;

describe('createDashboardRealtimeExtension handlers', () => {
  it('registers the dashboard-realtime extension with one handler per write operation', () => {
    const { name, handlers } = buildAllModelsHandlers();

    expect(name).toBe('dashboard-realtime');
    expect(Object.keys(handlers).sort()).toEqual([
      'create',
      'createMany',
      'delete',
      'deleteMany',
      'update',
      'updateMany',
      'upsert',
    ]);
  });

  describe.each(MUTATIONS)('%s', (operation, action) => {
    it(`emits ${action} with the result id and returns the query result`, async () => {
      const { handlers, emitEntityUpdated } = buildAllModelsHandlers();
      const result = { id: 'cust-1' };
      const args = { where: { id: 'cust-1' } };
      const query = jest.fn().mockResolvedValue(result);

      const returned = await runWithTenant(() =>
        handlers[operation].call(undefined, { model: 'Customer', args, query }),
      );

      expect(query).toHaveBeenCalledWith(args);
      expect(returned).toBe(result);
      expect(emitEntityUpdated).toHaveBeenCalledWith(TENANT_ID, {
        type: 'CUSTOMER',
        action,
        entityId: 'cust-1',
      });
    });

    it('emits only after the query has resolved', async () => {
      const { handlers, emitEntityUpdated } = buildAllModelsHandlers();
      let resolveQuery: (value: { id: string }) => void = () => undefined;
      const query = jest.fn(
        () =>
          new Promise<{ id: string }>((resolve) => {
            resolveQuery = resolve;
          }),
      );

      const pending = runWithTenant(() =>
        handlers[operation].call(undefined, {
          model: 'Customer',
          args: {},
          query,
        }),
      );
      await new Promise((resolve) => setImmediate(resolve));
      expect(emitEntityUpdated).not.toHaveBeenCalled();

      resolveQuery({ id: 'cust-1' });
      await pending;
      expect(emitEntityUpdated).toHaveBeenCalledTimes(1);
    });

    it('does not emit when the query rejects', async () => {
      const { handlers, emitEntityUpdated } = buildAllModelsHandlers();
      const query = jest.fn().mockRejectedValue(new Error('write failed'));

      await expect(
        runWithTenant(() =>
          handlers[operation].call(undefined, {
            model: 'Customer',
            args: {},
            query,
          }),
        ),
      ).rejects.toThrow('write failed');
      expect(emitEntityUpdated).not.toHaveBeenCalled();
    });

    it('emits nothing for models outside the realtime entity map', async () => {
      const { handlers, emitEntityUpdated } = buildAllModelsHandlers();
      const query = jest.fn().mockResolvedValue({ id: 'tenant-1' });

      await runWithTenant(() =>
        handlers[operation].call(undefined, {
          model: 'Tenant',
          args: {},
          query,
        }),
      );
      expect(emitEntityUpdated).not.toHaveBeenCalled();
    });

    it('still runs the query but emits nothing without a tenant in context', async () => {
      const { handlers, emitEntityUpdated } = buildAllModelsHandlers();
      const query = jest.fn().mockResolvedValue({ id: 'cust-2' });

      const returned = await handlers[operation].call(undefined, {
        model: 'Customer',
        args: {},
        query,
      });
      expect(query).toHaveBeenCalledTimes(1);
      expect(returned).toEqual({ id: 'cust-2' });
      expect(emitEntityUpdated).not.toHaveBeenCalled();
    });
  });

  describe('FISCAL_RECEIPT enrichment', () => {
    it('includes siteId from an included payment relation on update', async () => {
      const { handlers, emitEntityUpdated } = buildAllModelsHandlers();
      const query = jest.fn().mockResolvedValue({
        id: 'fr-1',
        state: 'SIGNED',
        payment: { site_id: 'site-9' },
      });

      await runWithTenant(() =>
        handlers.update.call(undefined, {
          model: 'FiscalReceipt',
          args: { where: { id: 'fr-1' }, data: { state: 'SIGNED' } },
          query,
        }),
      );

      expect(emitEntityUpdated).toHaveBeenCalledWith(TENANT_ID, {
        type: 'FISCAL_RECEIPT',
        action: 'UPDATED',
        entityId: 'fr-1',
        siteId: 'site-9',
        status: 'SIGNED',
      });
    });
  });

  describe('createMany', () => {
    it('never emits realtime events, even outside dry run', async () => {
      const { handlers, emitEntityUpdated } = buildAllModelsHandlers();
      const query = jest.fn().mockResolvedValue({ count: 2 });

      const returned = await runWithTenant(() =>
        handlers.createMany.call(undefined, {
          model: 'Customer',
          args: { data: [{ id: 'cust-1' }, { id: 'cust-2' }] },
          query,
        }),
      );

      expect(returned).toEqual({ count: 2 });
      expect(emitEntityUpdated).not.toHaveBeenCalled();
    });

    it('records each row with an id in the dry-run collector without emitting', async () => {
      const { handlers, emitEntityUpdated } = buildAllModelsHandlers();
      const collector = new DryRunChangeCollector();
      const query = jest.fn().mockResolvedValue({ count: 2 });

      await DryRunStorage.run({ isDryRun: true, collector }, () =>
        runWithTenant(() =>
          handlers.createMany.call(undefined, {
            model: 'Customer',
            args: {
              data: [{ id: 'cust-1' }, { name: 'no id' }, { id: 'cust-2' }],
            },
            query,
          }),
        ),
      );

      expect(collector.getChanges()).toEqual([
        { entity: 'Customer', id: 'cust-1', op: 'create', provisional: true },
        { entity: 'Customer', id: 'cust-2', op: 'create', provisional: true },
      ]);
      expect(emitEntityUpdated).not.toHaveBeenCalled();
    });

    it('treats a single data object as one record and records nothing without data', async () => {
      const { handlers } = buildAllModelsHandlers();
      const collector = new DryRunChangeCollector();
      const query = jest.fn().mockResolvedValue({ count: 0 });

      await DryRunStorage.run({ isDryRun: true, collector }, () =>
        runWithTenant(async () => {
          await handlers.createMany.call(undefined, {
            model: 'Customer',
            args: { data: { id: 'cust-9' } },
            query,
          });
          await handlers.createMany.call(undefined, {
            model: 'Customer',
            args: {},
            query,
          });
        }),
      );

      expect(collector.getChanges()).toEqual([
        { entity: 'Customer', id: 'cust-9', op: 'create', provisional: true },
      ]);
    });
  });

  describe('upsert', () => {
    it('checks for an existing row before the query, then emits UPDATED when one exists', async () => {
      const { handlers, emitEntityUpdated } = buildAllModelsHandlers();
      const calls: string[] = [];
      const findFirst = jest.fn(async () => {
        calls.push('findFirst');
        return { id: 'cust-1' };
      });
      const query = jest.fn(async () => {
        calls.push('query');
        return { id: 'cust-1' };
      });
      const where = { id: 'cust-1' };

      await runWithTenant(() =>
        handlers.upsert.call(
          { customer: { findFirst } },
          {
            model: 'Customer',
            args: { where, create: {}, update: {} },
            query,
          },
        ),
      );

      expect(findFirst).toHaveBeenCalledWith({ where, select: { id: true } });
      expect(calls).toEqual(['findFirst', 'query']);
      expect(emitEntityUpdated).toHaveBeenCalledWith(TENANT_ID, {
        type: 'CUSTOMER',
        action: 'UPDATED',
        entityId: 'cust-1',
      });
    });

    it('emits CREATED when no row matches the where clause', async () => {
      const { handlers, emitEntityUpdated } = buildAllModelsHandlers();
      const findFirst = jest.fn().mockResolvedValue(null);
      const query = jest.fn().mockResolvedValue({ id: 'cust-new' });

      await runWithTenant(() =>
        handlers.upsert.call(
          { customer: { findFirst } },
          { model: 'Customer', args: { where: { id: 'cust-new' } }, query },
        ),
      );

      expect(emitEntityUpdated).toHaveBeenCalledWith(TENANT_ID, {
        type: 'CUSTOMER',
        action: 'CREATED',
        entityId: 'cust-new',
      });
    });

    it('looks up the delegate by raw model name when no camelCase delegate exists', async () => {
      const { handlers, emitEntityUpdated } = buildAllModelsHandlers();
      const findFirst = jest.fn().mockResolvedValue(null);
      const query = jest.fn().mockResolvedValue({ id: 'wo-1' });

      await runWithTenant(() =>
        handlers.upsert.call(
          { WorkshopOrder: { findFirst } },
          { model: 'WorkshopOrder', args: { where: {} }, query },
        ),
      );

      expect(findFirst).toHaveBeenCalledTimes(1);
      expect(emitEntityUpdated).toHaveBeenCalledWith(TENANT_ID, {
        type: 'WORKSHOP_ORDER',
        action: 'CREATED',
        entityId: 'wo-1',
      });
    });

    it('emits CREATED without a pre-check when the context has no findFirst delegate', async () => {
      const { handlers, emitEntityUpdated } = buildAllModelsHandlers();
      const query = jest.fn().mockResolvedValue({ id: 'cust-3' });

      await runWithTenant(() =>
        handlers.upsert.call(
          {},
          { model: 'Customer', args: { where: {} }, query },
        ),
      );

      expect(query).toHaveBeenCalledTimes(1);
      expect(emitEntityUpdated).toHaveBeenCalledWith(TENANT_ID, {
        type: 'CUSTOMER',
        action: 'CREATED',
        entityId: 'cust-3',
      });
    });

    it('records an upsert as update when the row exists and as create when it does not, in dry run', async () => {
      const { handlers, emitEntityUpdated } = buildAllModelsHandlers();
      const collector = new DryRunChangeCollector();

      await DryRunStorage.run({ isDryRun: true, collector }, () =>
        runWithTenant(async () => {
          await handlers.upsert.call(
            {
              customer: {
                findFirst: jest.fn().mockResolvedValue({ id: 'cust-1' }),
              },
            },
            {
              model: 'Customer',
              args: { where: { id: 'cust-1' } },
              query: jest.fn().mockResolvedValue({ id: 'cust-1' }),
            },
          );
          await handlers.upsert.call(
            { customer: { findFirst: jest.fn().mockResolvedValue(null) } },
            {
              model: 'Customer',
              args: { where: { id: 'cust-new' } },
              query: jest.fn().mockResolvedValue({ id: 'cust-new' }),
            },
          );
        }),
      );

      expect(collector.getChanges()).toEqual([
        { entity: 'Customer', id: 'cust-1', op: 'update', provisional: false },
        { entity: 'Customer', id: 'cust-new', op: 'create', provisional: true },
      ]);
      expect(emitEntityUpdated).not.toHaveBeenCalled();
    });
  });
});
