import {
  MarginRuleItem,
  retailFromCost,
  roundPrice,
} from './retail-from-cost.util.js';

describe('retailFromCost and roundPrice', () => {
  describe('roundPrice', () => {
    it('handles ROUND_90 strategy', () => {
      expect(roundPrice(12.35, 'ROUND_90')).toBe(12.9);
      expect(roundPrice(12.0, 'ROUND_90')).toBe(12.9);
      expect(roundPrice(12.92, 'ROUND_90')).toBe(13.9);
      expect(roundPrice(12.9, 'ROUND_90')).toBe(12.9);
      expect(roundPrice(0.5, 'ROUND_90')).toBe(0.9);
    });

    it('handles ROUND_99 strategy', () => {
      expect(roundPrice(12.35, 'ROUND_99')).toBe(12.99);
      expect(roundPrice(12.0, 'ROUND_99')).toBe(12.99);
      expect(roundPrice(12.99, 'ROUND_99')).toBe(12.99);
      expect(roundPrice(13.01, 'ROUND_99')).toBe(13.99);
    });

    it('handles WHOLE_EURO strategy', () => {
      expect(roundPrice(12.35, 'WHOLE_EURO')).toBe(12);
      expect(roundPrice(12.5, 'WHOLE_EURO')).toBe(13);
      expect(roundPrice(12.8, 'WHOLE_EURO')).toBe(13);
    });

    it('handles NONE strategy (default 2 decimals)', () => {
      expect(roundPrice(12.345, 'NONE')).toBe(12.35);
      expect(roundPrice(12.344, 'NONE')).toBe(12.34);
      expect(roundPrice(10.0, 'NONE')).toBe(10);
      expect(roundPrice(12.345)).toBe(12.35);
    });
  });

  describe('retailFromCost', () => {
    const defaultMarkupRule: MarginRuleItem = {
      priority: 10,
      markup_percent: 50,
      use_supplier_rrp: false,
      rounding: 'NONE',
      is_active: true,
    };

    it('returns null when rules array is empty or no rule matches', () => {
      expect(retailFromCost(50, null, [])).toBeNull();
      expect(
        retailFromCost(50, null, [
          { priority: 1, brand_id: 999, markup_percent: 20 },
        ], { brandId: 100 }),
      ).toBeNull();
    });

    describe('missing or invalid cost in markup mode', () => {
      it('returns null when cost is null', () => {
        expect(retailFromCost(null, null, [defaultMarkupRule])).toBeNull();
      });

      it('returns null when cost is undefined', () => {
        expect(retailFromCost(undefined, null, [defaultMarkupRule])).toBeNull();
      });

      it('returns null when cost is 0', () => {
        expect(retailFromCost(0, null, [defaultMarkupRule])).toBeNull();
      });

      it('returns null when cost is negative', () => {
        expect(retailFromCost(-15.5, null, [defaultMarkupRule])).toBeNull();
      });

      it('returns null when cost is NaN', () => {
        expect(retailFromCost(Number.NaN, null, [defaultMarkupRule])).toBeNull();
      });
    });

    describe('RRP mode', () => {
      const rrpRule: MarginRuleItem = {
        priority: 1,
        use_supplier_rrp: true,
        markup_percent: 30,
        rounding: 'NONE',
        is_active: true,
      };

      it('uses supplier RRP when use_supplier_rrp is true and RRP is present', () => {
        expect(retailFromCost(20, 45.5, [rrpRule])).toBe(45.5);
      });

      it('uses supplier RRP even if cost is null', () => {
        expect(retailFromCost(null, 45.5, [rrpRule])).toBe(45.5);
      });

      it('falls back to markup % when RRP is missing (null/undefined)', () => {
        // Cost: 20, markup: 30% -> 20 * 1.30 = 26
        expect(retailFromCost(20, null, [rrpRule])).toBe(26);
        expect(retailFromCost(20, undefined, [rrpRule])).toBe(26);
      });

      it('falls back to markup % when RRP is zero or negative', () => {
        expect(retailFromCost(20, 0, [rrpRule])).toBe(26);
        expect(retailFromCost(20, -5, [rrpRule])).toBe(26);
      });

      it('returns null when RRP is missing and cost is also missing or non-positive', () => {
        expect(retailFromCost(null, null, [rrpRule])).toBeNull();
        expect(retailFromCost(0, null, [rrpRule])).toBeNull();
      });

      it('returns null when RRP is missing and markup_percent is null (prevents silent 0% margin)', () => {
        const rrpOnlyRule: MarginRuleItem = {
          id: 'rrp-only',
          priority: 1,
          use_supplier_rrp: true,
          markup_percent: null,
        };
        expect(retailFromCost(20, null, [rrpOnlyRule])).toBeNull();
        expect(retailFromCost(20, 0, [rrpOnlyRule])).toBeNull();
      });

      it('applies rounding to RRP when specified', () => {
        const rrpRuleRounded: MarginRuleItem = {
          ...rrpRule,
          rounding: 'ROUND_90',
        };
        // RRP 45.20 with ROUND_90 -> 45.90
        expect(retailFromCost(20, 45.2, [rrpRuleRounded])).toBe(45.9);
      });
    });

    describe('precedence and filtering', () => {
      it('matches rules sorted by priority (lowest integer first)', () => {
        const lowPriorityRule: MarginRuleItem = {
          id: 'rule-low',
          priority: 20,
          markup_percent: 20, // 100 -> 120
        };
        const highPriorityRule: MarginRuleItem = {
          id: 'rule-high',
          priority: 5,
          markup_percent: 40, // 100 -> 140
        };

        // Pass in reverse priority order
        const result = retailFromCost(100, null, [lowPriorityRule, highPriorityRule]);
        expect(result).toBe(140);
      });

      it('ignores inactive rules', () => {
        const inactiveRule: MarginRuleItem = {
          priority: 1,
          is_active: false,
          markup_percent: 100,
        };
        const activeRule: MarginRuleItem = {
          priority: 10,
          is_active: true,
          markup_percent: 20,
        };

        const result = retailFromCost(100, null, [inactiveRule, activeRule]);
        expect(result).toBe(120);
      });

      it('matches brand when brand_id is specified and falls back to wildcard', () => {
        const brandRule: MarginRuleItem = {
          priority: 1,
          brand_id: 42,
          markup_percent: 50,
        };
        const fallbackRule: MarginRuleItem = {
          priority: 10,
          brand_id: null,
          markup_percent: 25,
        };

        // Matches specific brand
        expect(
          retailFromCost(100, null, [brandRule, fallbackRule], { brandId: 42 }),
        ).toBe(150);

        // Falls back when brand does not match
        expect(
          retailFromCost(100, null, [brandRule, fallbackRule], { brandId: 99 }),
        ).toBe(125);

        // Falls back when context has no brand
        expect(
          retailFromCost(100, null, [brandRule, fallbackRule], {}),
        ).toBe(125);
      });

      it('matches revenue group when revenue_group_id is specified', () => {
        const revGroupRule: MarginRuleItem = {
          priority: 1,
          revenue_group_id: 7,
          markup_percent: 60,
        };
        const fallbackRule: MarginRuleItem = {
          priority: 10,
          revenue_group_id: null,
          markup_percent: 10,
        };

        expect(
          retailFromCost(100, null, [revGroupRule, fallbackRule], { revenueGroupId: 7 }),
        ).toBe(160);

        expect(
          retailFromCost(100, null, [revGroupRule, fallbackRule], { revenueGroupId: 8 }),
        ).toBe(110);
      });

      it('matches cost range bounds (cost_min and cost_max)', () => {
        const tier1: MarginRuleItem = {
          priority: 1,
          cost_min: 0,
          cost_max: 50,
          markup_percent: 100, // <= 50 -> 100% markup
        };
        const tier2: MarginRuleItem = {
          priority: 2,
          cost_min: 50.01,
          cost_max: 100,
          markup_percent: 50, // 50.01..100 -> 50% markup
        };
        const tier3: MarginRuleItem = {
          priority: 3,
          cost_min: 100.01,
          cost_max: null,
          markup_percent: 20, // > 100 -> 20% markup
        };

        const rules = [tier3, tier2, tier1];

        // Cost 30 in tier 1: 30 * 2 = 60
        expect(retailFromCost(30, null, rules)).toBe(60);
        // Cost 50 in tier 1: 50 * 2 = 100
        expect(retailFromCost(50, null, rules)).toBe(100);
        // Cost 80 in tier 2: 80 * 1.5 = 120
        expect(retailFromCost(80, null, rules)).toBe(120);
        // Cost 200 in tier 3: 200 * 1.2 = 240
        expect(retailFromCost(200, null, rules)).toBe(240);
      });
    });

    describe('markup calculation and rounding', () => {
      it('calculates markup and applies ROUND_90 rounding', () => {
        const rule: MarginRuleItem = {
          priority: 1,
          markup_percent: 20, // 10 * 1.2 = 12 -> ROUND_90 -> 12.90
          rounding: 'ROUND_90',
        };
        expect(retailFromCost(10, null, [rule])).toBe(12.9);
      });

      it('calculates markup and applies ROUND_99 rounding', () => {
        const rule: MarginRuleItem = {
          priority: 1,
          markup_percent: 20, // 10 * 1.2 = 12 -> ROUND_99 -> 12.99
          rounding: 'ROUND_99',
        };
        expect(retailFromCost(10, null, [rule])).toBe(12.99);
      });

      it('calculates markup and applies WHOLE_EURO rounding', () => {
        const rule: MarginRuleItem = {
          priority: 1,
          markup_percent: 23.5, // 10 * 1.235 = 12.35 -> WHOLE_EURO -> 12
          rounding: 'WHOLE_EURO',
        };
        expect(retailFromCost(10, null, [rule])).toBe(12);
      });

      it('defaults to 0% markup when markup_percent is null or undefined', () => {
        const rule: MarginRuleItem = {
          priority: 1,
          markup_percent: null,
          rounding: 'NONE',
        };
        expect(retailFromCost(45.5, null, [rule])).toBe(45.5);
      });
    });
  });
});
