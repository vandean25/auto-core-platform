import { cpSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(appRoot, 'dist/document-branding/assets');
mkdirSync(outputDirectory, { recursive: true });
cpSync(resolve(appRoot, 'src/document-branding/assets'), outputDirectory, {
  recursive: true,
});
