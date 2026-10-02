import { spawn } from 'node:child_process';
import {
  E2E_FULLSTACK_API_PORT,
  E2E_FULLSTACK_JWT_SECRET,
  E2E_FULLSTACK_WEB_PORT,
} from '../test/e2e-fullstack/constants.js';

process.env.NODE_ENV = 'test';
process.env.TEST_JWT_SECRET =
  process.env.TEST_JWT_SECRET ?? E2E_FULLSTACK_JWT_SECRET;
process.env.INVOICE_BRANDING_WRITER_ENABLED = 'true';
process.env.INVOICE_PDF_BUCKET =
  process.env.INVOICE_PDF_BUCKET ?? 'e2e-fullstack-invoice-pdf';
process.env.PORT = process.env.PORT ?? E2E_FULLSTACK_API_PORT;
process.env.E2E_FULLSTACK_IN_MEMORY_PDF = 'true';
process.env.FRONTEND_URL =
  process.env.FRONTEND_URL ?? `http://localhost:${E2E_FULLSTACK_WEB_PORT}`;

const child = spawn('node', ['dist/main.js'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
