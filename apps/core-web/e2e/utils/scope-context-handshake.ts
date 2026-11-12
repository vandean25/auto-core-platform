import type { Page } from '@playwright/test';

export const E2E_SCOPE_CONTEXT = {
  scopeContext: 'e2e-scope-context-token',
  scopeContextDigest: 'e2e-scope-context-digest',
  continuityDigest: 'e2e-continuity',
} as const;

const SCOPE_CONTEXT_ROUTE = /\/api\/auth\/scope-context(\?.*)?$/;

/** Handshake for ADR-0038 P4; optional `onPost` can mint a new digest to block the list. */
export async function mockScopeContextHandshake(
  page: Page,
  options?: { body?: typeof E2E_SCOPE_CONTEXT; onPost?: () => typeof E2E_SCOPE_CONTEXT },
) {
  await page.route(SCOPE_CONTEXT_ROUTE, async (route) => {
    const body = options?.onPost?.() ?? options?.body ?? E2E_SCOPE_CONTEXT;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}
