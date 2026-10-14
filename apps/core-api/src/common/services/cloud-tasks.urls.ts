import { InternalServerErrorException } from '@nestjs/common';
import type { PdfTaskKind } from '../pdf/pdf-task-payload.js';

const PDF_WORKER_PATH: Record<PdfTaskKind, (resourceId: string) => string> = {
  invoice: (resourceId) => `invoices/${resourceId}/pdf/worker`,
  'workshop-order': (resourceId) => `workshop/orders/${resourceId}/pdf/worker`,
  'workshop-estimate': (resourceId) =>
    `workshop/estimates/${resourceId}/pdf/worker`,
  'credit-note': (resourceId) => `credit-notes/${resourceId}/pdf/worker`,
  'vehicle-sale-kaufvertrag': (resourceId) =>
    `vehicle-sales/${resourceId}/kaufvertrag/pdf/worker`,
};

function withTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

export function resolveCloudTasksOidcAudience(targetBaseUrl: string): string {
  return new URL(withTrailingSlash(targetBaseUrl)).origin;
}

function buildCloudTasksTargetUrl(
  targetBaseUrl: string,
  relativePath: string,
): string {
  return new URL(relativePath, withTrailingSlash(targetBaseUrl)).toString();
}

export function buildPdfTaskUrl(
  targetBaseUrl: string,
  kind: PdfTaskKind,
  resourceId: string,
): string {
  try {
    return buildCloudTasksTargetUrl(
      targetBaseUrl,
      PDF_WORKER_PATH[kind](resourceId),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new InternalServerErrorException(
      `Invalid Cloud Tasks target base URL: ${message}`,
    );
  }
}

export function buildDocumentBrandingTaskUrl(
  targetBaseUrl: string,
  relativePath: string,
): string {
  try {
    return buildCloudTasksTargetUrl(targetBaseUrl, relativePath);
  } catch {
    throw new InternalServerErrorException(
      'Invalid Cloud Tasks target base URL',
    );
  }
}
