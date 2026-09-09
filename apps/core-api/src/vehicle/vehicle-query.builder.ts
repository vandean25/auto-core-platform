import { Prisma } from '@prisma/client';

export interface VehicleQueryParams {
  search?: string;
  page?: number;
  pageSize?: number;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
}

export interface VehiclePaginationParams {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export class VehicleQueryBuilder {
  static readonly DEFAULT_PAGE = 1;
  static readonly DEFAULT_PAGE_SIZE = 25;
  static readonly MAX_PAGE_SIZE = 100;
  static readonly DEFAULT_SORT_DIRECTION = 'desc' as const;

  static buildWhere(
    tenantId: string,
    search?: string,
  ): Prisma.VehicleWhereInput {
    if (!search) {
      return { tenant_id: tenantId };
    }

    return {
      tenant_id: tenantId,
      OR: [
        { make: { contains: search, mode: 'insensitive' } },
        { model: { contains: search, mode: 'insensitive' } },
        { plate: { contains: search, mode: 'insensitive' } },
        { vin: { contains: search, mode: 'insensitive' } },
        { engine_code: { contains: search, mode: 'insensitive' } },
        {
          customer: {
            OR: [
              { first_name: { contains: search, mode: 'insensitive' } },
              { last_name: { contains: search, mode: 'insensitive' } },
              { company_name: { contains: search, mode: 'insensitive' } },
            ],
          },
        },
      ],
    };
  }

  static computeOrderBy(
    sortField?: string,
    sortDirection: 'asc' | 'desc' = VehicleQueryBuilder.DEFAULT_SORT_DIRECTION,
  ): Prisma.VehicleOrderByWithRelationInput {
    switch (sortField) {
      case 'make':
        return { make: sortDirection };
      case 'model':
        return { model: sortDirection };
      case 'year':
        return { year: sortDirection };
      case 'plate':
        return { plate: sortDirection };
      case 'vin':
        return { vin: sortDirection };
      case 'customer':
        return { customer: { last_name: sortDirection } };
      default:
        return { createdAt: sortDirection };
    }
  }

  static resolvePagination(
    page?: number,
    pageSize?: number,
  ): VehiclePaginationParams {
    const resolvedPage = page && page > 0 ? page : this.DEFAULT_PAGE;
    const requestedSize =
      pageSize && pageSize > 0 ? pageSize : this.DEFAULT_PAGE_SIZE;
    const resolvedPageSize = Math.min(requestedSize, this.MAX_PAGE_SIZE);
    const skip = (resolvedPage - 1) * resolvedPageSize;

    return {
      page: resolvedPage,
      pageSize: resolvedPageSize,
      skip,
      take: resolvedPageSize,
    };
  }
}
