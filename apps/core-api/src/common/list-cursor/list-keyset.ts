import type { KeysetSortDirection } from './list-keyset.types.js';

export type { KeysetSortDirection } from './list-keyset.types.js';

/** Prisma `where` fragment: rows strictly after the cursor in sort order (NULLS LAST). */
export function buildKeysetAfterClause(
  sortField: string,
  direction: KeysetSortDirection,
  sortValue: unknown,
  id: string,
  options: { sortIsNullable: boolean },
): Record<string, unknown> {
  if (sortValue === null) {
    if (!options.sortIsNullable) {
      return { id: direction === 'asc' ? { gt: id } : { lt: id } };
    }
    return {
      AND: [
        { [sortField]: null },
        { id: direction === 'asc' ? { gt: id } : { lt: id } },
      ],
    };
  }

  const afterId =
    direction === 'asc' ? ({ gt: id } as const) : ({ lt: id } as const);
  const orBranches: Record<string, unknown>[] = [];

  if (direction === 'asc') {
    orBranches.push({ [sortField]: { gt: sortValue } });
    orBranches.push({ AND: [{ [sortField]: sortValue }, { id: afterId }] });
    if (options.sortIsNullable) {
      orBranches.push({ [sortField]: null });
    }
  } else {
    orBranches.push({ [sortField]: { lt: sortValue } });
    orBranches.push({ AND: [{ [sortField]: sortValue }, { id: afterId }] });
    if (options.sortIsNullable) {
      orBranches.push({ [sortField]: null });
    }
  }

  return { OR: orBranches };
}

/** AND-combine base list filters with an optional keyset continuation clause. */
export function andCombineListWhere(
  baseWhere: Record<string, unknown>,
  keysetClause?: Record<string, unknown>,
): Record<string, unknown> {
  if (!keysetClause || Object.keys(keysetClause).length === 0) {
    return baseWhere;
  }
  const baseKeys = Object.keys(baseWhere);
  if (baseKeys.length === 0) {
    return keysetClause;
  }
  return { AND: [baseWhere, keysetClause] };
}

export function buildPrismaNullsLastOrderBy(
  sortField: string,
  direction: KeysetSortDirection,
  options: { sortIsNullable: boolean; idDirection?: KeysetSortDirection },
): Record<string, unknown>[] {
  const idDirection = options.idDirection ?? direction;
  const primaryOrder = options.sortIsNullable
    ? { sort: direction, nulls: 'last' as const }
    : direction;
  return [{ [sortField]: primaryOrder }, { id: idDirection }];
}

export function sliceKeysetPage<T>(
  rows: T[],
  limit: number,
): {
  page: T[];
  hasNextPage: boolean;
} {
  const hasNextPage = rows.length > limit;
  return {
    page: hasNextPage ? rows.slice(0, limit) : rows,
    hasNextPage,
  };
}
