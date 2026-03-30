import { Prisma } from '@prisma/client';
import {
  ConflictError,
  NotFoundError,
  BadRequestError,
} from '../errors/application-errors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
}

/**
 * Structural contract every Prisma delegate satisfies.
 * Using this instead of `any` prevents consumers from accidentally passing
 * a function (e.g. `prisma.brand.findMany`) instead of the delegate itself.
 */
export interface PrismaDelegate {
  findMany(args?: any): Promise<any[]>;
  findUnique(args?: any): Promise<any | null>;
  create(args: any): Promise<any>;
  update(args: any): Promise<any>;
  delete(args: any): Promise<any>;
  count(args?: any): Promise<number>;
}

export interface FindManyParams {
  where?: Record<string, unknown>;
  orderBy?: Record<string, unknown> | Record<string, unknown>[];
  include?: Record<string, unknown>;
  select?: Record<string, unknown>;
}

export interface FindManyPaginatedParams extends FindManyParams {
  page?: number;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

/**
 * Thin, composable wrapper around a single Prisma delegate.
 *
 * **Boundary rule:** This class covers single-entity CRUD against one
 * delegate. Cross-entity queries (e.g. dependency checks that span multiple
 * tables) intentionally remain in the service layer via raw `PrismaService`.
 */
export class PrismaRepository<T> {
  constructor(private readonly model: PrismaDelegate) {}

  // ── Read ──────────────────────────────────────────────────────────────

  async findMany(params: FindManyParams = {}): Promise<T[]> {
    const { where, orderBy, include, select } = params;

    const records = await this.model.findMany({
      where,
      orderBy,
      include,
      select,
    });

    return records as T[];
  }

  async findManyPaginated(params: FindManyPaginatedParams = {}): Promise<PaginatedResult<T>> {
    const {
      where,
      orderBy,
      page = 1,
      limit = 25,
      include,
      select,
    } = params;

    if (page < 1 || limit < 1) {
      throw new BadRequestError(
        `Invalid pagination: page (${page}) and limit (${limit}) must be >= 1`,
      );
    }

    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, limit);
    const skip = (safePage - 1) * safeLimit;

    const [total, records] = await Promise.all([
      this.model.count({ where }),
      this.model.findMany({
        where,
        orderBy,
        skip,
        take: safeLimit,
        include,
        select,
      }),
    ]);

    const totalPages = Math.ceil(total / safeLimit);

    return {
      data: records as T[],
      meta: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages,
      },
    };
  }

  async findById(id: number | string, include?: Record<string, unknown>): Promise<T> {
    const record = await this.model.findUnique({
      where: { id },
      include,
    });

    if (!record) {
      throw new NotFoundError(`Record with ID ${id} not found`);
    }

    return record as T;
  }

  // ── Write ─────────────────────────────────────────────────────────────

  async create(data: Record<string, unknown>, include?: Record<string, unknown>): Promise<T> {
    try {
      return await this.model.create({ data, include }) as T;
    } catch (error) {
      throw this.mapPrismaError(error);
    }
  }

  async update(
    id: number | string,
    data: Record<string, unknown>,
    include?: Record<string, unknown>,
  ): Promise<T> {
    try {
      return await this.model.update({ where: { id }, data, include }) as T;
    } catch (error) {
      throw this.mapPrismaError(error, id);
    }
  }

  async delete(id: number | string): Promise<T> {
    try {
      return await this.model.delete({ where: { id } }) as T;
    } catch (error) {
      throw this.mapPrismaError(error, id);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  async count(where?: Record<string, unknown>): Promise<number> {
    return this.model.count({ where });
  }

  // ── Error Mapping ─────────────────────────────────────────────────────

  /**
   * Maps Prisma-specific errors to domain-neutral ApplicationErrors.
   * Returns the mapped error so callers can `throw this.mapPrismaError(e)`,
   * which keeps control flow explicit and immune to `: never` regressions.
   *
   * Currently handled codes:
   * - P2002  Unique constraint failed       → ConflictError
   * - P2003  Foreign key constraint failed   → ConflictError
   * - P2025  Record not found                → NotFoundError
   *
   * TODO: Evaluate P2014 (required relation) and P2016 (query interpretation)
   * when rolling out to services that use nested writes.
   */
  private mapPrismaError(error: unknown, id?: number | string): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      switch (error.code) {
        case 'P2002': {
          const target = (error.meta?.target as string[])?.join(', ') ?? 'unknown field';
          return new ConflictError(
            `Unique constraint violated on: ${target}`,
            target,
          );
        }
        case 'P2003': {
          const field = (error.meta?.field_name as string) ?? 'unknown relation';
          return new ConflictError(
            `Foreign key constraint failed on: ${field}`,
            field,
          );
        }
        case 'P2025':
          return new NotFoundError(
            id ? `Record with ID ${id} not found` : 'Record not found',
          );
      }
    }

    if (error instanceof Prisma.PrismaClientValidationError) {
      // Sanitize: don't leak raw Prisma schema details to API consumers
      return new BadRequestError(
        'Invalid data provided. Please check the request payload.',
      );
    }

    // Unknown / infrastructure errors — rethrow as-is so the global
    // exception filter can handle them (e.g. connection timeouts → 500).
    return error instanceof Error ? error : new Error(String(error));
  }
}
