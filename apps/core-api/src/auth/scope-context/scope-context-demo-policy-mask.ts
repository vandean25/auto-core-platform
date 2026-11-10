import {
  DEMO_MUTATION_ALLOWED_EXACT,
  DEMO_MUTATION_ALLOWED_PREFIXES,
  DEMO_MUTATION_BLOCKED_PREFIXES,
  DEMO_MUTATION_BLOCKED_SUBSTRINGS,
} from '../../landing-demo-access/demo-role-restrictions.js';

/** ADR-0038 §5 — demo mask entries that affect the contracted cursor routes. */
const SCOPE_CONTEXT_CONTRACTED_ROUTE_PREFIXES = [
  '/api/inventory',
  '/api/sales/invoices',
  '/api/vehicle-stock',
] as const;

function demoRuleAffectsContractedRoutes(rule: string): boolean {
  return SCOPE_CONTEXT_CONTRACTED_ROUTE_PREFIXES.some(
    (route) =>
      route === rule || route.startsWith(rule) || rule.startsWith(route),
  );
}

export function scopeContextDemoPolicyMask() {
  return {
    allowedExact: [...DEMO_MUTATION_ALLOWED_EXACT]
      .filter(demoRuleAffectsContractedRoutes)
      .sort(),
    allowedPrefixes: [...DEMO_MUTATION_ALLOWED_PREFIXES]
      .filter(demoRuleAffectsContractedRoutes)
      .sort(),
    blockedPrefixes: [...DEMO_MUTATION_BLOCKED_PREFIXES]
      .filter(demoRuleAffectsContractedRoutes)
      .sort(),
    blockedSubstrings: [...DEMO_MUTATION_BLOCKED_SUBSTRINGS]
      .filter((fragment) =>
        SCOPE_CONTEXT_CONTRACTED_ROUTE_PREFIXES.some((route) =>
          route.includes(fragment),
        ),
      )
      .sort(),
  };
}
