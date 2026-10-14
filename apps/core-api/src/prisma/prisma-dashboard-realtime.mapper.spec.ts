import type { DashboardEntityAction } from '../dashboard-realtime/dashboard-events.types.js';
import {
  actionToDryRunOp,
  extractEntityId,
  operationToAction,
} from './prisma-dashboard-realtime.mapper.js';

describe('prisma-dashboard-realtime mapper', () => {
  describe('operationToAction', () => {
    it.each<[string, DashboardEntityAction]>([
      ['create', 'CREATED'],
      ['update', 'UPDATED'],
      ['updateMany', 'UPDATED'],
      ['upsert', 'UPDATED'],
      ['delete', 'DELETED'],
      ['deleteMany', 'DELETED'],
    ])('maps %s to %s', (operation, action) => {
      expect(operationToAction(operation)).toBe(action);
    });

    it.each([
      'createMany',
      'findMany',
      'aggregate',
      'toString',
      'constructor',
      '__proto__',
    ])('returns null for %s, which is not a realtime write', (operation) => {
      expect(operationToAction(operation)).toBeNull();
    });
  });

  describe('actionToDryRunOp', () => {
    it.each<[DashboardEntityAction, 'create' | 'update' | 'delete']>([
      ['CREATED', 'create'],
      ['UPDATED', 'update'],
      ['DELETED', 'delete'],
    ])('maps %s to the dry-run op %s', (action, op) => {
      expect(actionToDryRunOp(action)).toBe(op);
    });

    it('returns undefined when there is no action', () => {
      expect(actionToDryRunOp(null)).toBeUndefined();
    });
  });

  describe('extractEntityId', () => {
    it('returns the string id of a result object', () => {
      expect(extractEntityId({ id: 'cust-1', name: 'Ada' })).toBe('cust-1');
    });

    it('returns an empty string id unchanged', () => {
      expect(extractEntityId({ id: '' })).toBe('');
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a string', 'cust-1'],
      ['a number', 42],
    ])('returns undefined for %s', (_label, result) => {
      expect(extractEntityId(result)).toBeUndefined();
    });

    it('returns undefined when the id is not a string', () => {
      expect(extractEntityId({ id: 7 })).toBeUndefined();
    });

    it('returns undefined for a batch result without an id', () => {
      expect(extractEntityId({ count: 3 })).toBeUndefined();
    });
  });
});
