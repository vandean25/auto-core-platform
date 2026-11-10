import { describe, expect, it } from '@jest/globals';
import {
  DEMO_MUTATION_ALLOWED_PREFIXES,
  DEMO_MUTATION_BLOCKED_PREFIXES,
} from '../../landing-demo-access/demo-role-restrictions.js';
import { scopeContextDemoPolicyMask } from './scope-context-demo-policy-mask.js';

describe('scopeContextDemoPolicyMask (AUT-937)', () => {
  it('includes only demo rules that affect contracted cursor routes', () => {
    const mask = scopeContextDemoPolicyMask();
    expect(mask.allowedPrefixes).not.toEqual([...DEMO_MUTATION_ALLOWED_PREFIXES].sort());
    expect(mask.blockedPrefixes.length).toBeLessThan(
      DEMO_MUTATION_BLOCKED_PREFIXES.length,
    );
    expect(mask.allowedPrefixes).toContain('/api/inventory');
    expect(mask.blockedPrefixes).toEqual(
      expect.arrayContaining(['/api/sales', '/api/vehicle-stock']),
    );
  });
});
