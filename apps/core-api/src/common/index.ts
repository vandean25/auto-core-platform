export { CommonModule } from './common.module.js';

// common barrel — single import path for shared utilities
export {
  PrismaRepository,
  type PrismaDelegate,
  type PaginatedResult,
  type PaginationMeta,
  type FindManyParams,
  type FindManyPaginatedParams,
} from './repositories/prisma-repository.js';

export {
  ApplicationError,
  NotFoundError,
  ConflictError,
  BadRequestError,
  ValidationError,
} from './errors/application-errors.js';

export { GlobalExceptionFilter } from './filters/global-exception.filter.js';
export {
  HttpLoggingInterceptor,
  type HttpRequestLog,
  LogLevelService,
  VALID_LOG_LEVELS,
  type AppLogLevel,
  type LogLevelOverride,
  type SetLogLevelOptions,
  type LogLevelStatus,
} from './logging/index.js';

export { CloudTasksService } from './services/cloud-tasks.service.js';
export {
  PdfStorage,
  PdfTaskTenantGuard,
  PdfWorker,
  signPdfTaskPayload,
  verifyPdfTaskPayload,
  type PdfTaskClaims,
  type PdfTaskKind,
  type SignedPdfTaskPayload,
} from './pdf/index.js';
export { PlaywrightBrowserService } from './services/playwright-browser.service.js';
export { createGlobalValidationPipe } from './validation.pipe.js';
export {
  STALE_STATUS_CONFLICT_MESSAGE,
  bindStatusUpdateMany,
  guardedStatusUpdate,
  type StatusUpdateMany,
  type GuardedStatusUpdateInput,
} from './utils/status-transition.js';
