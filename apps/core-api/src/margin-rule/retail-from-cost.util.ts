export type MarginRounding = 'NONE' | 'ROUND_90' | 'ROUND_99' | 'WHOLE_EURO';

export interface MarginRuleItem {
  id?: string;
  priority: number;
  brand_id?: number | null;
  revenue_group_id?: number | null;
  cost_min?: number | null;
  cost_max?: number | null;
  markup_percent?: number | null;
  use_supplier_rrp?: boolean;
  rounding?: MarginRounding;
  is_active?: boolean;
}

/**
 * Rounds a calculated price according to the specified rounding strategy.
 *
 * Strategies:
 * - NONE: Standard rounding to 2 decimal places.
 * - ROUND_90: Rounds up to the nearest ending of .90 (e.g. 12.35 -> 12.90, 12.00 -> 12.90, 12.92 -> 13.90).
 * - ROUND_99: Rounds up to the nearest ending of .99 (e.g. 12.35 -> 12.99, 12.00 -> 12.99).
 * - WHOLE_EURO: Rounds to nearest whole integer (e.g. 12.35 -> 12.00, 12.50 -> 13.00).
 */
export function roundPrice(
  price: number,
  strategy: MarginRounding = 'NONE',
): number {
  if (typeof price !== 'number' || !Number.isFinite(price)) {
    return 0;
  }

  // Pre-normalize to 2 decimal places to avoid IEEE 754 float precision drift
  const normalized = Math.round(price * 100) / 100;

  switch (strategy) {
    case 'WHOLE_EURO':
      return Math.round(normalized);

    case 'ROUND_90': {
      const floor = Math.floor(normalized);
      const target = Math.round((floor + 0.9) * 100) / 100;
      if (normalized <= target) {
        return target;
      }
      return Math.round((floor + 1.9) * 100) / 100;
    }

    case 'ROUND_99': {
      const floor = Math.floor(normalized);
      const target = Math.round((floor + 0.99) * 100) / 100;
      if (normalized <= target) {
        return target;
      }
      return Math.round((floor + 1.99) * 100) / 100;
    }

    case 'NONE':
    default:
      return normalized;
  }
}

/**
 * Pure calculation engine determining retail price from cost and optional supplier RRP
 * according to ordered margin rules and rounding strategies.
 *
 * Rules are matched in priority order (lowest integer priority first).
 * Returns null if no rule matches or if required cost is missing/non-positive in markup mode.
 */
/**
 * Finds the first matching active margin rule in priority order.
 */
export function findMatchingMarginRule(
  cost: number | null | undefined,
  rules: MarginRuleItem[],
  context?: { brandId?: number | null; revenueGroupId?: number | null },
): MarginRuleItem | null {
  if (!rules || rules.length === 0) {
    return null;
  }

  // Filter out inactive rules and sort by priority ascending (lowest integer first)
  const activeRules = rules
    .filter((r) => r.is_active !== false)
    .slice()
    .sort((a, b) => a.priority - b.priority);

  return (
    activeRules.find((rule) => {
      // Brand check: if rule specifies brand_id, must match context. If null, matches any brand.
      if (rule.brand_id != null && rule.brand_id !== context?.brandId) {
        return false;
      }

      // Revenue group check: if rule specifies revenue_group_id, must match context. If null, wildcard.
      if (
        rule.revenue_group_id != null &&
        rule.revenue_group_id !== context?.revenueGroupId
      ) {
        return false;
      }

      // Cost range bounds check
      if (rule.cost_min != null) {
        if (cost == null || cost < rule.cost_min) {
          return false;
        }
      }
      if (rule.cost_max != null) {
        if (cost == null || cost > rule.cost_max) {
          return false;
        }
      }

      return true;
    }) ?? null
  );
}

/**
 * Pure calculation engine determining retail price from cost and optional supplier RRP
 * according to ordered margin rules and rounding strategies.
 *
 * Rules are matched in priority order (lowest integer priority first).
 * Returns null if no rule matches, if required cost is missing/non-positive,
 * or if a "use UVP" rule has no usable UVP and no fallback markup percent.
 */
export function retailFromCost(
  cost: number | null | undefined,
  rrp: number | null | undefined,
  rules: MarginRuleItem[],
  context?: { brandId?: number | null; revenueGroupId?: number | null },
): number | null {
  const matchedRule = findMatchingMarginRule(cost, rules, context);
  if (!matchedRule) {
    return null;
  }

  const rounding = matchedRule.rounding ?? 'NONE';

  // RRP Mode: if use_supplier_rrp is true
  if (matchedRule.use_supplier_rrp) {
    if (rrp != null && !Number.isNaN(rrp) && rrp > 0) {
      return roundPrice(rrp, rounding);
    }
    // If no usable UVP provided, fallback to markup_percent ONLY if explicitly defined
    if (matchedRule.markup_percent == null) {
      return null;
    }
  }

  // Markup Mode (or fallback from missing RRP with defined markup_percent)
  if (cost == null || Number.isNaN(cost) || cost <= 0) {
    return null;
  }

  const markupPercent = matchedRule.markup_percent ?? 0;
  const rawRetail = cost * (1 + markupPercent / 100);

  return roundPrice(rawRetail, rounding);
}
