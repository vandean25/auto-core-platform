import {
  getOriginatingAgentId,
  isPlainRecord,
  isWorkshopOrderLineAction,
  readExecutionSiteId,
  resolveWorkshopOrderId,
} from './agent-proposal-payload.js';

describe('agent-proposal payload helpers', () => {
  describe('isPlainRecord', () => {
    it('accepts plain objects only', () => {
      expect(isPlainRecord({ a: 1 })).toBe(true);
      expect(isPlainRecord(null)).toBe(false);
      expect(isPlainRecord([])).toBe(false);
      expect(isPlainRecord('text')).toBe(false);
      expect(isPlainRecord(undefined)).toBe(false);
    });
  });

  describe('isWorkshopOrderLineAction', () => {
    it('matches add_line and propose_line only', () => {
      expect(isWorkshopOrderLineAction('workshop_order.add_line')).toBe(true);
      expect(isWorkshopOrderLineAction('workshop_order.propose_line')).toBe(
        true,
      );
      expect(isWorkshopOrderLineAction('workshop_order.create')).toBe(false);
    });
  });

  describe('resolveWorkshopOrderId', () => {
    it('reads the first non-empty order key for line actions', () => {
      expect(
        resolveWorkshopOrderId('workshop_order.add_line', {
          order_id: '',
          orderId: 'wo-2',
        }),
      ).toBe('wo-2');
      expect(
        resolveWorkshopOrderId('workshop_order.propose_line', {
          workshop_order_id: 'wo-3',
        }),
      ).toBe('wo-3');
    });

    it('ignores empty and non-string values', () => {
      expect(
        resolveWorkshopOrderId('workshop_order.add_line', {
          order_id: '',
          orderId: 42,
        }),
      ).toBeNull();
    });

    it('returns null for actions that do not reference a workshop order', () => {
      expect(
        resolveWorkshopOrderId('customer.update', { order_id: 'wo-1' }),
      ).toBeNull();
    });
  });

  describe('getOriginatingAgentId', () => {
    it('prefers agent_id and falls back to agentId', () => {
      expect(getOriginatingAgentId({ agent_id: 'a-1', agentId: 'a-2' })).toBe(
        'a-1',
      );
      expect(getOriginatingAgentId({ agentId: 'a-2' })).toBe('a-2');
    });

    it('returns undefined for missing, empty or non-object payloads', () => {
      expect(getOriginatingAgentId({ agent_id: '' })).toBeUndefined();
      expect(getOriginatingAgentId(['a-1'])).toBeUndefined();
      expect(getOriginatingAgentId(null)).toBeUndefined();
    });
  });

  describe('readExecutionSiteId', () => {
    it('reads the simulated site from the preview execution context', () => {
      expect(
        readExecutionSiteId({ execution_context: { site_id: 'site-9' } }),
      ).toBe('site-9');
    });

    it('returns undefined when the preview has no usable site', () => {
      expect(readExecutionSiteId(null)).toBeUndefined();
      expect(readExecutionSiteId(['site-9'])).toBeUndefined();
      expect(
        readExecutionSiteId({ execution_context: ['site-9'] }),
      ).toBeUndefined();
      expect(
        readExecutionSiteId({ execution_context: { site_id: 9 } }),
      ).toBeUndefined();
    });
  });
});
