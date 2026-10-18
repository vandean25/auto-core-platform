import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import type { WorkshopEstimatePdfStream } from './workshop-estimate-pdf.service.js';

export async function serveWorkshopEstimatePdfDownload(
  loadPdf: (versionId: string) => Promise<WorkshopEstimatePdfStream>,
  versionId: string,
  res: Response,
): Promise<void> {
  const { stream, filename, contentType, contentLength } =
    await loadPdf(versionId);
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
