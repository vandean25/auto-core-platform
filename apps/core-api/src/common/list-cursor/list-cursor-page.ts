import type { ListCursorEndpointId } from './list-cursor.constants.js';
import { LIST_CURSOR_VERSION } from './list-cursor.constants.js';
import {
  deserializeSortValueFromCursor,
  encodeListCursor,
  parseListCursorParam,
  serializeSortValueForCursor,
} from './list-cursor.codec.js';
import { hashListFilterContext } from './list-cursor.filter-hash.js';
import {
  andCombineListWhere,
  buildKeysetAfterClause,
  buildPrismaNullsLastOrderBy,
  sliceKeysetPage,
} from './list-keyset.js';
import type { KeysetSortDirection } from './list-keyset.types.js';

export type CursorSortConfig = {
  prismaField: string;
  valueKind: 'string' | 'number' | 'int' | 'decimal' | 'date' | 'enum';
  nullable: boolean;
};

export type KeysetListPageRequest = {
  endpoint: ListCursorEndpointId;
  tenantId: string;
  siteId: string;
  filterHashInput: Record<string, unknown>;
  sortField: string;
  sortDirection: KeysetSortDirection;
  sortConfig: CursorSortConfig;
  cursor?: string;
  limit: number;
  baseWhere: Record<string, unknown>;
};

export type KeysetListPageResult<TRow> = {
  data: TRow[];
  meta: { nextCursor: string | null; hasNextPage: boolean; limit: number };
};

function buildKeysetNextCursor<TRecord extends { id: string }>(
  request: KeysetListPageRequest,
  direction: KeysetSortDirection,
  filterHash: string,
  last: TRecord,
  readSortValue: (record: TRecord, prismaField: string) => unknown,
): string {
  return encodeListCursor({
    v: LIST_CURSOR_VERSION,
    ep: request.endpoint,
    sort: request.sortField,
    dir: direction,
    fh: filterHash,
    tid: request.tenantId,
    sid: request.siteId,
    sv: serializeSortValueForCursor(
      readSortValue(last, request.sortConfig.prismaField),
    ),
    id: last.id,
  });
}

export async function fetchKeysetListPage<TRecord extends { id: string }, TRow>(
  request: KeysetListPageRequest,
  deps: {
    findMany: (
      where: Record<string, unknown>,
      orderBy: Record<string, unknown>[],
      take: number,
    ) => Promise<TRecord[]>;
    mapRow: (record: TRecord) => TRow;
    readSortValue: (record: TRecord, prismaField: string) => unknown;
  },
): Promise<KeysetListPageResult<TRow>> {
  const filterHash = hashListFilterContext(request.filterHashInput);
  const decoded = parseListCursorParam(request.cursor, {
    endpoint: request.endpoint,
    tenantId: request.tenantId,
    siteId: request.siteId,
    filterHash,
    sortField: request.sortField,
    sortDirection: request.sortDirection,
  });
  const { sortConfig, sortDirection: direction } = request;
  let keysetClause: Record<string, unknown> | undefined;
  if (decoded) {
    const sortValue = deserializeSortValueFromCursor(
      decoded.sv,
      sortConfig.valueKind,
    );
    keysetClause = buildKeysetAfterClause(
      sortConfig.prismaField,
      direction,
      sortValue,
      decoded.id,
      { sortIsNullable: sortConfig.nullable },
    );
  }
  const where = andCombineListWhere(request.baseWhere, keysetClause);
  const orderBy = buildPrismaNullsLastOrderBy(
    sortConfig.prismaField,
    direction,
    { sortIsNullable: sortConfig.nullable, idDirection: direction },
  );
  const rows = await deps.findMany(where, orderBy, request.limit + 1);
  const { page, hasNextPage } = sliceKeysetPage(rows, request.limit);
  const last = page.at(-1);
  const nextCursor =
    hasNextPage && last
      ? buildKeysetNextCursor(
          request,
          direction,
          filterHash,
          last,
          deps.readSortValue,
        )
      : null;
  return {
    data: page.map(deps.mapRow),
    meta: { nextCursor, hasNextPage, limit: request.limit },
  };
}
