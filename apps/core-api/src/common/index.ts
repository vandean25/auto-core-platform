// common barrel — single import path for shared utilities
export {
  PrismaRepository,
  type PrismaDelegate,
  type PaginatedResult,
  type PaginationMeta,
  type FindManyParams,
  type FindManyPaginatedParams,
} from './repositories/prisma-repository';

export {
  ApplicationError,
  NotFoundError,
  ConflictError,
  BadRequestError,
  ValidationError,
} from './errors/application-errors';
