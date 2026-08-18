export { CommonModule } from './common.module';

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

export { GlobalExceptionFilter } from './filters/global-exception.filter';
export {
  HttpLoggingInterceptor,
  type HttpRequestLog,
  LogLevelService,
  VALID_LOG_LEVELS,
  type AppLogLevel,
  type LogLevelOverride,
  type SetLogLevelOptions,
  type LogLevelStatus,
} from './logging';

export { CloudTasksService } from './services/cloud-tasks.service';
export {
  PdfStorage,
  PdfTaskTenantGuard,
  PdfWorker,
  signPdfTaskPayload,
  verifyPdfTaskPayload,
  type PdfTaskClaims,
  type PdfTaskKind,
  type SignedPdfTaskPayload,
} from './pdf';
export { PlaywrightBrowserService } from './services/playwright-browser.service';
export {
  STALE_STATUS_CONFLICT_MESSAGE,
  bindStatusUpdateMany,
  guardedStatusUpdate,
  type StatusUpdateMany,
  type GuardedStatusUpdateInput,
} from './utils/status-transition';
