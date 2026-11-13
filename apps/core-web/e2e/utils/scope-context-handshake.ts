import type { Page } from '@playwright/test';

export const E2E_SCOPE_CONTEXT = {
  scopeContext: 'e2e-scope-context-token',
  scopeContextDigest: 'e2e-scope-context-digest',
  continuityDigest: 'e2e-continuity',
} as const;

const SCOPE_CONTEXT_ROUTE = /\/api\/auth\/scope-context(\?.*)?$/;

type ScopeHandshakePage = Page & { __acpScopeHandshakeInstalled?: boolean; __acpScopeDigest?: string };

/** Digest echoed on this page's list responses. Kept on the page, so a digest minted in one test cannot leak into the next. */
export function e2eActiveScopeContextDigest(page: Page): string {
  return (page as ScopeHandshakePage).__acpScopeDigest ?? E2E_SCOPE_CONTEXT.scopeContextDigest;
}

/** Handshake for ADR-0038 P4; optional `onPost` can mint a new digest to block the list. */
export async function mockScopeContextHandshake(
  page: Page,
  options?: { body?: typeof E2E_SCOPE_CONTEXT; onPost?: () => typeof E2E_SCOPE_CONTEXT },
) {
  const scoped = page as ScopeHandshakePage;
  await page.unroute(SCOPE_CONTEXT_ROUTE);
  await page.route(SCOPE_CONTEXT_ROUTE, async (route) => {
    const body = options?.onPost?.() ?? options?.body ?? E2E_SCOPE_CONTEXT;
    scoped.__acpScopeDigest = body.scopeContextDigest;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  scoped.__acpScopeHandshakeInstalled = true;
}

export function scopeContextHandshakeInstalled(page: Page): boolean {
  return Boolean((page as ScopeHandshakePage).__acpScopeHandshakeInstalled);
}

export async function ensureDefaultScopeContextHandshake(page: Page) {
  if (scopeContextHandshakeInstalled(page)) {
    return;
  }
  await mockScopeContextHandshake(page);
}
