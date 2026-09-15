import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

export interface ESMContractFile {
  readonly filePath: string;
  readonly source: string;
}

export interface ESMContractViolation {
  readonly filePath: string;
  readonly line: number;
  readonly message: string;
}

const MAINTAINED_RUNTIME_EXTENSIONS = new Set(['.mjs', '.ts']);
const RELATIVE_IMPORT_PATTERN =
  /(?:from\s+|import\s*(?:\(\s*)?)["'](\.{1,2}\/[^"']+)["']/;
const COMMONJS_REQUIRE_PATTERN = /\brequire\s*\(/;
const COMMONJS_EXPORT_PATTERN = /\b(?:module\.exports|exports\.)/;

export function findEsmContractViolations(
  files: readonly ESMContractFile[],
): ESMContractViolation[] {
  const violations: ESMContractViolation[] = [];

  for (const file of files) {
    const lines = file.source.split(/\r?\n/);
    lines.forEach((line, index) => {
      const sourceLine = stripComments(line);
      const importMatch = sourceLine.match(RELATIVE_IMPORT_PATTERN);
      if (importMatch && !hasRuntimeExtension(importMatch[1])) {
        violations.push({
          filePath: file.filePath,
          line: index + 1,
          message: `Relative import must include an explicit runtime extension: ${importMatch[1]}`,
        });
      }
      if (COMMONJS_REQUIRE_PATTERN.test(sourceLine)) {
        violations.push({
          filePath: file.filePath,
          line: index + 1,
          message: 'CommonJS require() is not allowed in maintained ESM runtime code',
        });
      }
      if (COMMONJS_EXPORT_PATTERN.test(sourceLine)) {
        violations.push({
          filePath: file.filePath,
          line: index + 1,
          message: 'CommonJS module.exports/exports is not allowed in maintained ESM runtime code',
        });
      }
    });
  }

  return violations;
}

export function collectMaintainedRuntimeFiles(rootDirectory: string): ESMContractFile[] {
  return collectFiles(rootDirectory, rootDirectory);
}

function collectFiles(directory: string, rootDirectory: string): ESMContractFile[] {
  const files: ESMContractFile[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', 'coverage'].includes(entry.name)) {
        files.push(...collectFiles(entryPath, rootDirectory));
      }
      continue;
    }
    if (
      entry.isFile() &&
      !isExcludedFile(entry.name) &&
      MAINTAINED_RUNTIME_EXTENSIONS.has(extname(entry.name))
    ) {
      files.push({
        filePath: relative(rootDirectory, entryPath),
        source: readFileSync(entryPath, 'utf8'),
      });
    }
  }
  return files;
}

function isExcludedFile(fileName: string): boolean {
  return (
    fileName.endsWith('.spec.ts') ||
    fileName === 'check-esm-contract.ts' ||
    fileName === 'verify-esm-artifact.mjs' ||
    fileName === 'migrate-teardown.mjs'
  );
}

function hasRuntimeExtension(specifier: string): boolean {
  return /\.(?:js|mjs|cjs|json|node)$/.test(specifier);
}

function stripComments(line: string): string {
  return line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
}

function main(): void {
  const files = collectMaintainedRuntimeFiles(join(import.meta.dirname, '..'));
  const violations = findEsmContractViolations(files);
  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`${violation.filePath}:${violation.line} ${violation.message}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`ESM contract passed for ${files.length} maintained runtime files.`);
}

if (import.meta.filename === process.argv[1]) {
  main();
}
