import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';

const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_PROCESS_MEMORY_BYTES = 256 * 1024 * 1024;
const RESERVED_PROCESS_BYTES = 64 * 1024 * 1024;
const MAX_PROCESS_WALL_TIME_MS = 15_000;
const WORKER_HEAP_MB = 192;
const WORKER_SEMI_SPACE_MB = 16;

type PdfWorkerResponse =
  | { type: 'memory'; rss: number; heapUsed: number; external: number }
  | { type: 'phase'; name: string }
  | {
      type: 'result';
      pageCount: number;
      width: number;
      height: number;
      raster: Buffer;
    }
  | { type: 'error'; code: string; message: string };

export type DocumentBrandPdfRaster = {
  pageCount: number;
  width: number;
  height: number;
  raster: Buffer;
  warning: 'PDF_ADDITIONAL_PAGES_IGNORED' | null;
};

export class DocumentBrandingPdfParser {
  static readonly memoryLimitBytes = MAX_PROCESS_MEMORY_BYTES;
  static readonly wallTimeLimitMs = MAX_PROCESS_WALL_TIME_MS;

  async validateAndRasterize(bytes: Buffer): Promise<DocumentBrandPdfRaster> {
    if (bytes.byteLength > MAX_INPUT_BYTES) {
      throw new PayloadTooLargeException({
        code: 'BRAND_UPLOAD_TOO_LARGE',
        message: 'Document branding upload exceeds its size limit.',
      });
    }
    if (!startsWithPdfSignature(bytes)) {
      throw parserException('BRAND_PDF_INVALID', 'The PDF file is malformed.');
    }
    if (hasEncryptedTrailer(bytes)) {
      throw parserException(
        'BRAND_PDF_ENCRYPTED',
        'Encrypted PDF files are not accepted.',
      );
    }

    return this.runIsolatedParser(bytes);
  }

  private runIsolatedParser(bytes: Buffer): Promise<DocumentBrandPdfRaster> {
    const workerFile = resolveWorkerFile();
    const isSourceTypeScript = workerFile.endsWith('.ts');
    const worker = fork(workerFile, [], {
      execArgv: isSourceTypeScript
        ? [
            '--import=tsx',
            `--max-old-space-size=${WORKER_HEAP_MB}`,
            `--max-semi-space-size=${WORKER_SEMI_SPACE_MB}`,
          ]
        : [
            `--max-old-space-size=${WORKER_HEAP_MB}`,
            `--max-semi-space-size=${WORKER_SEMI_SPACE_MB}`,
          ],
      env: workerEnvironment(),
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });

    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        fail(
          parserException(
            'BRAND_PDF_PROCESS_TIMEOUT',
            'PDF validation exceeded its 15-second processing limit.',
          ),
        );
      }, MAX_PROCESS_WALL_TIME_MS);

      worker.on('message', (message: PdfWorkerResponse) => {
        if (message.type === 'phase') {
          return;
        }
        if (message.type === 'memory') {
          if (exceedsProcessMemoryLimit(message)) {
            fail(
              parserException(
                'BRAND_PDF_MEMORY_LIMIT',
                'PDF validation exceeded its 256 MiB process limit.',
              ),
            );
          }
          return;
        }
        if (message.type === 'error') {
          fail(parserException(message.code, message.message));
          return;
        }
        if (message.type === 'result') {
          finish(() =>
            resolve({
              pageCount: message.pageCount,
              width: message.width,
              height: message.height,
              raster: Buffer.from(message.raster),
              warning:
                message.pageCount > 1 ? 'PDF_ADDITIONAL_PAGES_IGNORED' : null,
            }),
          );
        }
      });

      worker.once('error', () => {
        fail(
          parserException(
            'BRAND_PDF_INVALID',
            'PDF validation could not safely process this file.',
          ),
        );
      });
      worker.once('exit', () => {
        if (!settled) {
          fail(
            parserException(
              'BRAND_PDF_INVALID',
              'PDF validation could not safely process this file.',
            ),
          );
        }
      });

      worker.send({ bytes });

      function fail(error: Error): void {
        finish(() => reject(error));
      }

      function finish(action: () => void): void {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        worker.kill('SIGKILL');
        action();
      }
    });
  }
}

function exceedsProcessMemoryLimit(usage: {
  heapUsed: number;
  external: number;
}): boolean {
  return (
    usage.heapUsed + usage.external + RESERVED_PROCESS_BYTES >
    MAX_PROCESS_MEMORY_BYTES
  );
}

function resolveWorkerFile(): string {
  const typescriptWorker = fileURLToPath(
    new URL('./document-branding-pdf-parser-worker.ts', import.meta.url),
  );
  if (existsSync(typescriptWorker)) return typescriptWorker;
  return fileURLToPath(
    new URL('./document-branding-pdf-parser-worker.js', import.meta.url),
  );
}

function workerEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: process.env.NODE_ENV ?? 'production',
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    SYSTEMROOT: process.env.SYSTEMROOT,
    WINDIR: process.env.WINDIR,
  };
}

function startsWithPdfSignature(bytes: Buffer): boolean {
  return bytes.subarray(0, 5).toString('ascii') === '%PDF-';
}

function hasEncryptedTrailer(bytes: Buffer): boolean {
  return /\/Encrypt\b/.test(bytes.toString('latin1'));
}

function parserException(
  code: string,
  message: string,
): UnprocessableEntityException {
  return new UnprocessableEntityException({ code, message });
}
