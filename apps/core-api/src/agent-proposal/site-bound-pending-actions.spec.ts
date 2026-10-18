import {
  isSiteBoundPendingAction,
  siteBoundExecutionContext,
} from './site-bound-pending-actions.js';

describe('site-bound pending actions', () => {
  describe('isSiteBoundPendingAction', () => {
    it('matches site-scoped workshop and intake actions only', () => {
      expect(isSiteBoundPendingAction('workshop_order.create')).toBe(true);
      expect(isSiteBoundPendingAction('workshop_order.add_line')).toBe(false);
      expect(isSiteBoundPendingAction('customer.update')).toBe(false);
    });
  });

  describe('siteBoundExecutionContext', () => {
    it('returns site_id for site-bound actions when the preview carries it', () => {
      expect(
        siteBoundExecutionContext('workshop_order.create', {
          execution_context: { site_id: 'site-9' },
        }),
      ).toEqual({ site_id: 'site-9' });
    });

    it('returns undefined for non-site-bound actions or missing preview site', () => {
      expect(
        siteBoundExecutionContext('workshop_order.add_line', {
          execution_context: { site_id: 'site-9' },
        }),
      ).toBeUndefined();
      expect(
        siteBoundExecutionContext('workshop_order.create', {}),
      ).toBeUndefined();
    });
  });
});
