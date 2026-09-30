import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { DocumentBrandingCropRect } from './document-branding-extraction-response.js';

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_PROCESS_MEMORY_BYTES = 256 * 1024 * 1024;
const RESERVED_PROCESS_BYTES = 64 * 1024 * 1024;
const MAX_PROCESS_WALL_TIME_MS = 15_000;
const WORKER_HEAP_MB = 192;
const WORKER_SEMI_SPACE_MB = 16;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

type WorkerRequest =
  | { mode: 'normalize'; bytes: Buffer }
  | {
      mode: 'crop';
      bytes: Buffer;
      cropRect: DocumentBrandingCropRect | null;
    };
type WorkerResponse =
  | { type: 'memory'; rss: number; heapUsed: number; external: number }
  | { type: 'result'; bytes: Buffer; width: number; height: number }
  | { type: 'error'; code: string };
export type NormalizedDocumentBrandingRaster = {
  bytes: Buffer;
  width: number;
  height: number;
};

export class DocumentBrandingExtractionImageProcessor {
  async normalizePng(bytes: Buffer): Promise<NormalizedDocumentBrandingRaster> {
    this.assertPngInput(bytes);
    return this.runWorker({ mode: 'normalize', bytes });
  }

  async cropLogo(
    bytes: Buffer,
    cropRect: DocumentBrandingCropRect | null,
  ): Promise<NormalizedDocumentBrandingRaster> {
    this.assertPngInput(bytes);
    return this.runWorker({ mode: 'crop', bytes, cropRect });
  }

  private assertPngInput(bytes: Buffer): void {
    if (bytes.byteLength > MAX_SOURCE_BYTES) {
      throw new PayloadTooLargeException({
        code: 'BRAND_UPLOAD_TOO_LARGE',
        message: 'Document branding upload exceeds its size limit.',
      });
    }
    if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      throw this.invalidImage('BRAND_PNG_INVALID');
    }
  }

  private runWorker(
    input: WorkerRequest,
  ): Promise<NormalizedDocumentBrandingRaster> {
    const workerFile = resolveWorkerFile();
    const worker = fork(workerFile, [], {
      execArgv: workerExecArguments(workerFile),
      env: workerEnvironment(),
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });

    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        fail(this.invalidImage('BRAND_IMAGE_PROCESS_TIMEOUT'));
      }, MAX_PROCESS_WALL_TIME_MS);
      const finish = (action: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        worker.kill('SIGKILL');
        action();
      };
      const fail = (error: Error): void => finish(() => reject(error));

      worker.on('message', (message: WorkerResponse) => {
        if (message.type === 'memory') {
          if (exceedsMemoryLimit(message)) {
            fail(this.invalidImage('BRAND_IMAGE_MEMORY_LIMIT'));
          }
          return;
        }
        if (message.type === 'error') {
          fail(this.invalidImage(message.code));
          return;
        }
        finish(() =>
          resolve({
            bytes: Buffer.from(message.bytes),
            width: message.width,
            height: message.height,
          }),
        );
      });

      worker.once('error', () => {
        fail(this.invalidImage('BRAND_PNG_INVALID'));
      });
      worker.once('exit', () => {
        if (!settled) fail(this.invalidImage('BRAND_PNG_INVALID'));
      });

      worker.send(input);
    });
  }

  private invalidImage(code: string): UnprocessableEntityException {
    const message =
      code === 'BRAND_IMAGE_PROCESS_TIMEOUT'
        ? 'Image processing exceeded its 15-second limit.'
        : 'The document branding image could not be safely processed.';
    return new UnprocessableEntityException({ code, message });
  }
}

function resolveWorkerFile(): string {
  const typescriptWorker = fileURLToPath(
    new URL('./document-branding-extraction-image-worker.ts', import.meta.url),
  );
  if (existsSync(typescriptWorker)) return typescriptWorker;
  return fileURLToPath(
    new URL('./document-branding-extraction-image-worker.js', import.meta.url),
  );
}

function workerExecArguments(workerFile: string): string[] {
  const isSourceTypeScript = workerFile.endsWith('.ts');
  return isSourceTypeScript
    ? [
        '--import=tsx',
        `--max-old-space-size=${WORKER_HEAP_MB}`,
        `--max-semi-space-size=${WORKER_SEMI_SPACE_MB}`,
      ]
    : [
        `--max-old-space-size=${WORKER_HEAP_MB}`,
        `--max-semi-space-size=${WORKER_SEMI_SPACE_MB}`,
      ];
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

function exceedsMemoryLimit(
  usage: Extract<WorkerResponse, { type: 'memory' }>,
): boolean {
  return (
    usage.rss > MAX_PROCESS_MEMORY_BYTES ||
    usage.heapUsed + usage.external + RESERVED_PROCESS_BYTES >
      MAX_PROCESS_MEMORY_BYTES
  );
}
