import type { Page } from '@playwright/test';
import { AutoCorePage } from '../pom/AutoCorePage';
import { createMockListResponse } from './mock-factories';

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
};

/** Every request a mocked list received, in order, as parsed URLs. */
/** `failList` is switchable while a test runs: true answers every list request with a 500. */
export type CursorListRequests = { list: URL[]; count: URL[]; failList: boolean };

/** Distinct blocks asked for so far (first block = no cursor). A block may be requested twice, e.g. after a session reset. */
export const requestedBlocks = (requests: CursorListRequests) =>
  new Set(requests.list.map((url) => url.searchParams.get('cursor')));

/**
 * Mocks one ADR-0035 pilot list: cursor requests (`pagination=cursor` / `cursor=`) get `{ data, meta: { nextCursor, hasNextPage } }`
 * blocks with an opaque `offset:<n>` cursor; offset requests get the classic `page`/`pageSize` response, so a page that falls
 * back to offset mode keeps working. Demo data only, no backend.
 */
export async function mockCursorList<TRow>(
  page: Page,
  { path, rows, count, failCount = false, maxLimit = 50, unpaged = 'offset' }: CursorListMockOptions<TRow>,
): Promise<CursorListRequests> {
  const requests: CursorListRequests = { list: [], count: [], failList: false };

  await page.route(AutoCorePage.apiRouteMatcher(`${path}/capped-count`), async (route) => {
    requests.count.push(new URL(route.request().url()));
    if (failCount) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      return;
    }
    const body: CappedCount = count ?? { count: Math.min(rows.length, 1000), isCapped: rows.length > 1000 };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.route(AutoCorePage.apiRouteMatcher(path), async (route) => {
    const url = new URL(route.request().url());
    requests.list.push(url);
    if (requests.failList) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      return;
    }
    const params = url.searchParams;

    if (params.get('pagination') === 'cursor' || params.has('cursor')) {
      const limit = Math.min(Number(params.get('limit') ?? maxLimit), maxLimit);
      const start = Number((params.get('cursor') ?? 'offset:0').split(':')[1]);
      const end = start + limit;
      const body = {
        data: rows.slice(start, end),
        meta: { nextCursor: end < rows.length ? `offset:${end}` : null, hasNextPage: end < rows.length, limit },
      };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      return;
    }

    if (unpaged === 'array') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
      return;
    }

    const pageSize = Number(params.get('pageSize') ?? 10);
    const pageNumber = Number(params.get('page') ?? 1);
    const body = createMockListResponse(rows.slice((pageNumber - 1) * pageSize, pageNumber * pageSize), rows.length);
    body.meta = { ...body.meta, page: pageNumber, limit: pageSize, pageCount: Math.ceil(rows.length / pageSize), totalPages: Math.ceil(rows.length / pageSize) };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  return requests;
}
