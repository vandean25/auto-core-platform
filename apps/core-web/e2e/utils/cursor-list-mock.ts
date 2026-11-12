import type { Page } from '@playwright/test';
import { AutoCorePage } from '../pom/AutoCorePage';
import { createMockListResponse } from './mock-factories';
import { E2E_SCOPE_CONTEXT, mockScopeContextHandshake } from './scope-context-handshake';

type CappedCount = { count: number; isCapped: boolean };

type CursorListMockOptions<TRow> = {
  /** List endpoint, e.g. `/api/vehicle-stock`; its capped count is served at `<path>/capped-count`. */
  path: string;
  rows: TRow[];
  /** Answer of the capped-count endpoint. Defaults to the exact number of rows. */
  count?: CappedCount;
  /** When set, the capped count fails with a 500. */
  failCount?: boolean;
  /** Block size of the mock; the real API clamps `limit` the same way. */
  maxLimit?: number;
  /** Shape of the answer to a request without cursor mode: the classic `page`/`pageSize` envelope (default) or the unpaged array of the invoice list. */
  unpaged?: 'offset' | 'array';
  /** When set, controls successive `POST /api/auth/scope-context` responses (for blocked-list specs). */
  handshakePost?: () => typeof E2E_SCOPE_CONTEXT;
};

/** Every request a mocked list received, in order, as parsed URLs. */
/** `failList` is switchable while a test runs: true answers every list request with a 500. */
export type CursorListRequests = { list: URL[]; count: URL[]; failList: boolean };

/** Distinct blocks asked for so far (first block = no cursor). A block may be requested twice, e.g. after a session reset. */
export const requestedBlocks = (requests: CursorListRequests) =>
  new Set(requests.list.map((url) => url.searchParams.get('cursor')));

/** One cursor block: rows `[start, start + limit)` with an opaque `offset:<n>` cursor to the next. */
function cursorBlock<TRow>(rows: TRow[], params: URLSearchParams, maxLimit: number) {
  const limit = Math.min(Number(params.get('limit') ?? maxLimit), maxLimit);
  const start = Number((params.get('cursor') ?? 'offset:0').split(':')[1]);
  const end = start + limit;
  return {
    data: rows.slice(start, end),
    meta: { nextCursor: end < rows.length ? `offset:${end}` : null, hasNextPage: end < rows.length, limit },
  };
}

/** The classic `page`/`pageSize` envelope of an offset list. */
function offsetPage<TRow>(rows: TRow[], params: URLSearchParams) {
  const pageSize = Number(params.get('pageSize') ?? 10);
  const pageNumber = Number(params.get('page') ?? 1);
  const body = createMockListResponse(rows.slice((pageNumber - 1) * pageSize, pageNumber * pageSize), rows.length);
  const pageCount = Math.ceil(rows.length / pageSize);
  body.meta = { ...body.meta, page: pageNumber, limit: pageSize, pageCount, totalPages: pageCount };
  return body;
}

function listBody<TRow>(rows: TRow[], params: URLSearchParams, { maxLimit, unpaged }: { maxLimit: number; unpaged: 'offset' | 'array' }) {
  if (params.get('pagination') === 'cursor' || params.has('cursor')) return cursorBlock(rows, params, maxLimit);
  return unpaged === 'array' ? rows : offsetPage(rows, params);
}

/**
 * Mocks one ADR-0035 pilot list: cursor requests (`pagination=cursor` / `cursor=`) get `{ data, meta: { nextCursor, hasNextPage } }`
 * blocks with an opaque `offset:<n>` cursor; offset requests get the classic `page`/`pageSize` response, so a page that falls
 * back to offset mode keeps working. Demo data only, no backend.
 */
export const E2E_SCOPE_CONTEXT_DIGEST = E2E_SCOPE_CONTEXT.scopeContextDigest;

export function e2eCappedCountBody(count: number, isCapped = false) {
  return { count, isCapped, scopeContextDigest: E2E_SCOPE_CONTEXT_DIGEST };
}

export function e2eCursorPageBody<TRow>(
  data: TRow[],
  meta: { nextCursor?: string | null; hasNextPage?: boolean; limit?: number } = {},
) {
  return {
    data,
    meta: {
      nextCursor: meta.nextCursor ?? null,
      hasNextPage: meta.hasNextPage ?? false,
      limit: meta.limit,
      scopeContextDigest: E2E_SCOPE_CONTEXT_DIGEST,
    },
  };
}

export { mockScopeContextHandshake } from './scope-context-handshake';

export async function mockCursorList<TRow>(
  page: Page,
  { path, rows, count, failCount = false, maxLimit = 50, unpaged = 'offset', handshakePost }: CursorListMockOptions<TRow>,
): Promise<CursorListRequests> {
  const requests: CursorListRequests = { list: [], count: [], failList: false };

  await mockScopeContextHandshake(page, handshakePost ? { onPost: handshakePost } : undefined)

  await page.route(AutoCorePage.apiRouteMatcher(`${path}/capped-count`), async (route) => {
    requests.count.push(new URL(route.request().url()));
    if (failCount) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      return;
    }
    const body = { ...(count ?? { count: Math.min(rows.length, 1000), isCapped: rows.length > 1000 }), scopeContextDigest: E2E_SCOPE_CONTEXT.scopeContextDigest };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.route(AutoCorePage.apiRouteMatcher(path), async (route) => {
    const url = new URL(route.request().url());
    requests.list.push(url);
    if (requests.failList) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      return;
    }
    const body = listBody(rows, url.searchParams, { maxLimit, unpaged }) as { data?: unknown; meta?: Record<string, unknown> };
    if (body.meta) body.meta.scopeContextDigest = E2E_SCOPE_CONTEXT.scopeContextDigest;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  return requests;
}
