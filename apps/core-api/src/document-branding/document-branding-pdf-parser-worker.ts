import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const MAX_PAGES = 5;
const TARGET_DPI = 150;
const MAX_RASTER_SIDE = 2048;
const MAX_RASTER_PIXELS = 4_000_000;
const MAX_MEMORY_BYTES = 256 * 1024 * 1024;
const RESERVED_PROCESS_BYTES = 64 * 1024 * 1024;

type ParseRequest = { bytes: Buffer };

type WorkerResult = {
  pageCount: number;
  width: number;
  height: number;
  raster: Buffer;
};

type WorkerError = { code: string; message: string };

const memoryReporter = setInterval(() => {
  const usage = process.memoryUsage();
  process.send?.({
    type: 'memory',
    rss: usage.rss,
    heapUsed: usage.heapUsed,
    external: usage.external,
  });
}, 100);

process.once('message', (request: ParseRequest) => {
  process.send?.({ type: 'phase', name: 'parse-start' });
  void parseDocument(request.bytes)
    .then((result) => process.send?.({ type: 'result', ...result }))
    .catch((error: unknown) => {
      const failure = toWorkerError(error);
      process.send?.({ type: 'error', ...failure });
    })
    .finally(() => {
      clearInterval(memoryReporter);
      process.disconnect?.();
    });
});

async function parseDocument(bytes: Buffer): Promise<WorkerResult> {
  const serializedPdf = bytes.toString('latin1');
  if (hasEmbeddedFileTokens(serializedPdf)) {
    throw createWorkerError(
      'BRAND_PDF_EMBEDDED_FILE',
      'PDF files with embedded files are not accepted.',
    );
  }

  const loadingTask = getDocument({
    data: Uint8Array.from(bytes),
    disableFontFace: true,
    stopAtErrors: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  process.send?.({ type: 'phase', name: 'document-loading' });
  const document = await loadingTask.promise;
  process.send?.({ type: 'phase', name: 'pdf-loaded' });
  try {
    if (document.numPages > MAX_PAGES) {
      throw createWorkerError(
        'BRAND_PDF_PAGE_LIMIT',
        'PDF files may contain at most five pages.',
      );
    }

    const metadata = await document.getMetadata();
    const metadataInfo = metadata.info as Record<string, unknown>;
    if (metadataInfo.IsEncrypted || metadataInfo.isEncrypted) {
      throw createWorkerError(
        'BRAND_PDF_ENCRYPTED',
        'Encrypted PDF files are not accepted.',
      );
    }
    if (
      (await document.getJSActions()) ||
      (await document.hasJSActions()) ||
      (await document.getOpenAction()) ||
      (await document.getAttachments()) ||
      hasUnsafeActionTokens(serializedPdf)
    ) {
      throw createWorkerError(
        hasEmbeddedFileTokens(serializedPdf)
          ? 'BRAND_PDF_EMBEDDED_FILE'
          : 'BRAND_PDF_ACTIONS',
        'PDF files with active actions or embedded files are not accepted.',
      );
    }

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const annotations = await page.getAnnotations({ intent: 'display' });
      if (annotations.some(hasActiveAnnotationContent)) {
        throw createWorkerError(
          'BRAND_PDF_ACTIONS',
          'PDF files with active actions are not accepted.',
        );
      }
    }

    process.send?.({ type: 'phase', name: 'before-raster' });
    const page = await document.getPage(1);
    const viewport = boundedViewport(
      page.getViewport({ scale: TARGET_DPI / 72 }),
    );
    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext('2d');
    await page.render({
      canvas: null,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport: page.getViewport({ scale: viewport.scale }),
      background: '#ffffff',
    }).promise;

    const raster = canvas.toBuffer('image/png');
    process.send?.({ type: 'phase', name: 'after-raster' });
    if (raster.byteLength > 10 * 1024 * 1024) {
      throw createWorkerError(
        'BRAND_PDF_RASTER_TOO_LARGE',
        'The first-page raster exceeds the accepted size.',
      );
    }
    if (exceedsMemoryLimit(process.memoryUsage())) {
      throw createWorkerError(
        'BRAND_PDF_MEMORY_LIMIT',
        'PDF validation exceeded its 256 MiB process limit.',
      );
    }
    return {
      pageCount: document.numPages,
      width: viewport.width,
      height: viewport.height,
      raster,
    };
  } finally {
    await loadingTask.destroy();
  }
}

function boundedViewport(viewport: { width: number; height: number }) {
  if (
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    throw createWorkerError(
      'BRAND_PDF_INVALID',
      'The PDF page size is invalid.',
    );
  }

  const scale = Math.min(
    1,
    MAX_RASTER_SIDE / Math.max(viewport.width, viewport.height),
    Math.sqrt(MAX_RASTER_PIXELS / (viewport.width * viewport.height)),
  );
  return {
    scale: (TARGET_DPI / 72) * scale,
    width: Math.max(1, Math.floor(viewport.width * scale)),
    height: Math.max(1, Math.floor(viewport.height * scale)),
  };
}

function hasEmbeddedFileTokens(pdf: string): boolean {
  return /\/(?:EmbeddedFiles|EF|AF)\b/.test(pdf);
}

function hasUnsafeActionTokens(pdf: string): boolean {
  return /\/(?:OpenAction|AA)\b|\/S\s*\/(?:Launch|GoToR|URI|SubmitForm|ImportData|ResetForm|JavaScript)\b/.test(
    pdf,
  );
}

function hasActiveAnnotationContent(annotation: unknown): boolean {
  if (annotation === null || typeof annotation !== 'object') return false;
  const record = annotation as Record<string, unknown>;
  return Boolean(
    record.action ||
    record.url ||
    record.unsafeUrl ||
    record.hasJSActions ||
    record.attachment,
  );
}

function createWorkerError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function exceedsMemoryLimit(usage: NodeJS.MemoryUsage): boolean {
  return (
    usage.heapUsed + usage.external + RESERVED_PROCESS_BYTES > MAX_MEMORY_BYTES
  );
}

function toWorkerError(error: unknown): WorkerError {
  if (error && typeof error === 'object' && 'code' in error) {
    return {
      code: String(error.code),
      message:
        error instanceof Error ? error.message : 'PDF validation failed.',
    };
  }
  const isPasswordError =
    error &&
    typeof error === 'object' &&
    'name' in error &&
    String(error.name).includes('Password');
  return {
    code: isPasswordError ? 'BRAND_PDF_ENCRYPTED' : 'BRAND_PDF_INVALID',
    message: isPasswordError
      ? 'Encrypted PDF files are not accepted.'
      : 'The PDF file is malformed or could not be safely processed.',
  };
}

process.on('uncaughtException', (error: unknown) => {
  const failure = toWorkerError(error);
  process.send?.({ type: 'error', ...failure });
});

process.on('unhandledRejection', (error: unknown) => {
  const failure = toWorkerError(error);
  process.send?.({ type: 'error', ...failure });
});
