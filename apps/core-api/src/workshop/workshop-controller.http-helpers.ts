import { applyDecorators, BadRequestException } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import type { WorkshopPdfService } from './workshop-pdf.service.js';

function parsePositiveInteger(value?: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!/^\d+$/.test(value) || parseInt(value, 10) <= 0) {
    throw new BadRequestException(
      'page and pageSize must be positive integers',
    );
  }
  return parseInt(value, 10);
}

export function parsePaginationParams(
  page?: string,
  pageSize?: string,
): { page?: number; pageSize?: number } {
  return {
    page: parsePositiveInteger(page),
    pageSize: parsePositiveInteger(pageSize),
  };
}

export function ApiWorkshopPaginationQueries() {
  return applyDecorators(
    ApiQuery({ name: 'search', required: false, schema: { type: 'string' } }),
    ApiQuery({
      name: 'page',
      required: false,
      schema: { type: 'integer', minimum: 1 },
    }),
    ApiQuery({
      name: 'pageSize',
      required: false,
      schema: { type: 'integer', minimum: 1 },
    }),
    ApiQuery({
      name: 'sortField',
      required: false,
      schema: { type: 'string' },
    }),
    ApiQuery({
      name: 'sortDirection',
      required: false,
      schema: { type: 'string', enum: ['asc', 'desc'] },
    }),
  );
}

export const WORKSHOP_ERROR_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    code: { type: 'string' },
    statusCode: { type: 'number' },
  },
} as const;

export async function enqueueWorkshopPdfGeneration(
  pdfService: WorkshopPdfService,
  orderId: string,
) {
  const targetBaseUrl = process.env.CLOUD_TASKS_TARGET_BASE_URL ?? '';
  const result = await pdfService.requestGeneration(orderId, { targetBaseUrl });
  if (result.mode === 'enqueued') {
    return {
      message: 'PDF generation enqueued',
      enqueued: true,
      taskId: result.taskId,
    };
  }
  return {
    message: 'PDF is ready',
    enqueued: false,
  };
}

export async function serveWorkshopPdfDownload(
  pdfService: WorkshopPdfService,
  orderId: string,
  res: Response,
) {
  const { stream, filename, contentType, contentLength } =
    await pdfService.getPdf(orderId);
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  res.set({
    'Content-Type': contentType,
    'Content-Disposition': `inline; filename="${safeFilename}"`,
  });
  if (contentLength != null) {
    res.set('Content-Length', contentLength.toString());
  }
  await pipeline(stream, res);
}
