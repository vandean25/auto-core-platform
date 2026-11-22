import type { KeysetSortDirection } from './list-keyset.types.js';

export type { KeysetSortDirection } from './list-keyset.types.js';

export type KeysetSecondarySort = {
  field: string;
  value: unknown;
  nullable: boolean;
};

/** Prisma `where` fragment: rows strictly after the cursor in sort order (NULLS LAST). */
export function buildKeysetAfterClause(
  sortField: string,
  direction: KeysetSortDirection,
  sortValue: unknown,
  id: string,
  options: { sortIsNullable: boolean; secondary?: KeysetSecondarySort },
): Record<string, unknown> {
  const afterId =
    direction === 'asc' ? ({ gt: id } as const) : ({ lt: id } as const);
  const tieBreak = options.secondary
    ? buildKeysetAfterClause(
        options.secondary.field,
        direction,
        options.secondary.value,
        id,
        { sortIsNullable: options.secondary.nullable },
      )
    : { id: afterId };

  if (sortValue === null) {
    if (!options.sortIsNullable) {
      return tieBreak;
    }
    return {
      AND: [{ [sortField]: null }, tieBreak],
    };
  }

  const cmp = direction === 'asc' ? 'gt' : 'lt';
  const orBranches: Record<string, unknown>[] = [
    { [sortField]: { [cmp]: sortValue } },
    { AND: [{ [sortField]: sortValue }, tieBreak] },
  ];
  if (options.sortIsNullable) {
    orBranches.push({ [sortField]: null });
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
  options: {
    sortIsNullable: boolean;
    idDirection?: KeysetSortDirection;
    secondary?: { field: string; nullable: boolean };
  },
): Record<string, unknown>[] {
  const idDirection = options.idDirection ?? direction;
  const primaryOrder = options.sortIsNullable
    ? { sort: direction, nulls: 'last' as const }
    : direction;
  const orderBy: Record<string, unknown>[] = [{ [sortField]: primaryOrder }];
  if (options.secondary) {
    orderBy.push({
      [options.secondary.field]: options.secondary.nullable
        ? { sort: direction, nulls: 'last' as const }
        : direction,
    });
  }
  orderBy.push({ id: idDirection });
  return orderBy;
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
