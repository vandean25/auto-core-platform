import {
  applyDecorators,
  HttpCode,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Public } from '../decorators/public.decorator.js';
import { CloudTasksWorkerGuard } from '../guards/cloud-tasks-worker.guard.js';
import { PdfTaskTenantGuard } from './pdf-task-tenant.guard.js';
import { PDF_TASK_KIND_KEY, type PdfTaskKind } from './pdf-task-payload.js';

export function PdfWorker(kind: PdfTaskKind) {
  return applyDecorators(
    SetMetadata(PDF_TASK_KIND_KEY, kind),
    Public(),
    ApiExcludeEndpoint(),
    UseGuards(CloudTasksWorkerGuard, PdfTaskTenantGuard),
    HttpCode(204),
  );
}
