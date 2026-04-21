export interface FilterParam {
  field: string;
  operator:
    | 'equals'
    | 'contains'
    | 'startsWith'
    | 'endsWith'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'in'
    | 'notIn';
  value: string | number | boolean | string[] | number[];
}

export interface SortParam {
  field: string;
  direction: 'asc' | 'desc';
}

export interface QueryParams {
  filters?: FilterParam[];
  sorting?: SortParam[];
  page?: number;
  pageSize?: number;
  search?: string; // Global search fallback
}

export interface PrismaQueryResult<T = Record<string, unknown>> {
  where: T;
  orderBy?: Record<string, unknown> | Record<string, unknown>[];
  skip: number;
  take: number;
}

export class QueryBuilder {
  static buildWhere(
    filters: FilterParam[] = [],
    whitelist: string[],
    globalSearch?: string,
    searchFields?: string[],
  ): Record<string, unknown> {
    const where: Record<string, unknown> = {};

    // 1. Process explicit filters
    for (const filter of filters) {
      if (!whitelist.includes(filter.field)) {
        continue; // Skip fields not in whitelist
      }

      const fieldParts = filter.field.split('.');
      let currentLevel = where;

      // Navigate or create nested objects for relations
      for (let i = 0; i < fieldParts.length - 1; i++) {
        const part = fieldParts[i];
        if (!currentLevel[part]) {
          currentLevel[part] = {};
        }
        currentLevel = currentLevel[part] as Record<string, unknown>;
      }

      const fieldName = fieldParts[fieldParts.length - 1];
      const prismaOperator = this.mapOperator(filter.operator, filter.value);

      // Handle cases where multiple filters apply to the same field (basic overwriting for now, could use AND)
      currentLevel[fieldName] = prismaOperator;
    }

    // 2. Process Global Search (OR condition)
    if (globalSearch && searchFields && searchFields.length > 0) {
      const searchConditions = searchFields.map((field) => {
        // Only allow searching if the field is in whitelist or explicitly allowed for search
        // For simplicity, we assume searchFields are valid
        const parts = field.split('.');
        if (parts.length === 1) {
          return { [field]: { contains: globalSearch, mode: 'insensitive' } };
        }
        // Nested search
        const nestedCondition: Record<string, unknown> = {};
        let current = nestedCondition;
        for (let i = 0; i < parts.length - 1; i++) {
          current[parts[i]] = {};
          current = current[parts[i]] as Record<string, unknown>;
        }
        current[parts[parts.length - 1]] = {
          contains: globalSearch,
          mode: 'insensitive',
        };
        return nestedCondition;
      });

      if (Object.keys(where).length > 0) {
        where['AND'] = [
          { ...where }, // Existing specific filters
          { OR: searchConditions }, // Plus global search
        ];
        // Clean up the top-level keys that were moved to AND
        for (const key of Object.keys(where)) {
          if (key !== 'AND') delete where[key];
        }
      } else {
        where['OR'] = searchConditions;
      }
    }

    return where;
  }

  static buildOrderBy(
    sorting: SortParam[] = [],
    whitelist: string[],
  ): Record<string, unknown>[] | undefined {
    const orderBy: Record<string, unknown>[] = [];

    for (const sort of sorting) {
      if (!whitelist.includes(sort.field)) {
        continue;
      }

      const fieldParts = sort.field.split('.');
      const orderObject: Record<string, unknown> = {};
      let currentLevel = orderObject;

      for (let i = 0; i < fieldParts.length - 1; i++) {
        const part = fieldParts[i];
        currentLevel[part] = {};
        currentLevel = currentLevel[part] as Record<string, unknown>;
      }

      currentLevel[fieldParts[fieldParts.length - 1]] = sort.direction;
      orderBy.push(orderObject);
    }

    return orderBy.length > 0 ? orderBy : undefined;
  }

  static buildPagination(
    page: number = 1,
    pageSize: number = 25,
  ): { skip: number; take: number } {
    const safePage = Math.max(1, page);
    const safePageSize = Math.max(1, Math.min(100, pageSize)); // Cap at 100

    return {
      skip: (safePage - 1) * safePageSize,
      take: safePageSize,
    };
  }

  static buildPrismaQuery(
    params: QueryParams,
    whitelist: string[],
    searchFields?: string[],
  ): PrismaQueryResult {
    const { filters, sorting, page, pageSize, search } = params;

    const where = this.buildWhere(filters, whitelist, search, searchFields);
    const orderBy = this.buildOrderBy(sorting, whitelist);
    const { skip, take } = this.buildPagination(page, pageSize);

    return {
      where,
      orderBy,
      skip,
      take,
    };
  }

  private static mapOperator(
    operator: string,
    value: string | number | boolean | string[] | number[],
  ): Record<string, unknown> {
    switch (operator) {
      case 'equals':
        return { equals: value };
      case 'contains':
        return { contains: value, mode: 'insensitive' };
      case 'startsWith':
        return { startsWith: value, mode: 'insensitive' };
      case 'endsWith':
        return { endsWith: value, mode: 'insensitive' };
      case 'gt':
        return { gt: value };
      case 'gte':
        return { gte: value };
      case 'lt':
        return { lt: value };
      case 'lte':
        return { lte: value };
      case 'in':
        return { in: Array.isArray(value) ? value : [value] };
      case 'notIn':
        return { notIn: Array.isArray(value) ? value : [value] };
      default:
        return { equals: value };
    }
  }
}
