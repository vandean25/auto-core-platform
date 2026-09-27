import type { Request, Response } from 'express';

const PDF_GET_PATH = /\/pdf\/?$/;

export function isPdfDownloadGetRequest(request: Request): boolean {
  return request.method === 'GET' && PDF_GET_PATH.test(request.path);
}

export function applyPdfDownloadNoStoreCacheControl(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Pragma', 'no-cache');
}

export function applyPdfDownloadCacheControlIfNeeded(
  request: Request,
  response: Response,
): void {
  if (isPdfDownloadGetRequest(request)) {
    applyPdfDownloadNoStoreCacheControl(response);
  }
}
