import {
  applyDecorators,
  HttpCode,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Public } from '../decorators/public.decorator';
import { CloudTasksWorkerGuard } from '../guards/cloud-tasks-worker.guard';
import { PdfTaskTenantGuard } from './pdf-task-tenant.guard';
import { PDF_TASK_KIND_KEY, type PdfTaskKind } from './pdf-task-payload';

export function PdfWorker(kind: PdfTaskKind) {
  return applyDecorators(
    SetMetadata(PDF_TASK_KIND_KEY, kind),
    Public(),
    ApiExcludeEndpoint(),
    UseGuards(CloudTasksWorkerGuard, PdfTaskTenantGuard),
    HttpCode(204),
  );
}
