import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { isDirectRun } from './is-direct-run.mjs';

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
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'coverage']);
const COMMONJS_REQUIRE_PATTERN = /\brequire\s*\(/;
const COMMONJS_CREATE_REQUIRE_PATTERN = /\bcreateRequire\s*\(/;
const COMMONJS_EXPORT_PATTERN = /\b(?:module\.exports|exports\.)/;
const COMMONJS_PATH_GLOBAL_PATTERN = /\b__(?:dirname|filename)\b/;
const CODE_IMPORT_PREFIX_PATTERN = /(?:from|import\s*\()\s*$/;
const RELATIVE_SPECIFIER_PATTERN = /^\.{1,2}\//;

export function findEsmContractViolations(
  files: readonly ESMContractFile[],
): ESMContractViolation[] {
  const violations: ESMContractViolation[] = [];

  for (const file of files) {
    for (const relativeImport of findCodeRelativeImports(file.source)) {
      if (!hasRuntimeExtension(relativeImport.specifier)) {
        violations.push({
          filePath: file.filePath,
          line: relativeImport.line,
          message: `Relative import must include an explicit runtime extension: ${relativeImport.specifier}`,
        });
      }
    }
    stripCommentsPreservingLines(file.source).forEach((sourceLine, index) => {
      const runtimeLine = blankStringLiterals(sourceLine);
      if (COMMONJS_REQUIRE_PATTERN.test(runtimeLine)) {
        violations.push({
          filePath: file.filePath,
          line: index + 1,
          message: 'CommonJS require() is not allowed in maintained ESM runtime code',
        });
      }
      if (COMMONJS_CREATE_REQUIRE_PATTERN.test(runtimeLine)) {
        violations.push({
          filePath: file.filePath,
          line: index + 1,
          message: 'CommonJS createRequire() is not allowed in maintained ESM runtime code',
        });
      }
      if (COMMONJS_EXPORT_PATTERN.test(runtimeLine)) {
        violations.push({
          filePath: file.filePath,
          line: index + 1,
          message: 'CommonJS module.exports/exports is not allowed in maintained ESM runtime code',
        });
      }
      if (COMMONJS_PATH_GLOBAL_PATTERN.test(runtimeLine)) {
        violations.push({
          filePath: file.filePath,
          line: index + 1,
          message: 'CommonJS __dirname/__filename is not allowed in maintained ESM runtime code',
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
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        files.push(...collectFiles(entryPath, rootDirectory));
      }
      continue;
    }
    if (entry.isFile() && MAINTAINED_RUNTIME_EXTENSIONS.has(extname(entry.name))) {
      files.push({
        filePath: relative(rootDirectory, entryPath),
        source: readFileSync(entryPath, 'utf8'),
      });
    }
  }
  return files;
}

function findCodeRelativeImports(
  source: string,
): Array<{ line: number; specifier: string }> {
  const imports: Array<{ line: number; specifier: string }> = [];
  let line = 1;
  let index = 0;
  let state: 'code' | 'singleQuote' | 'doubleQuote' | 'template' | 'lineComment' | 'blockComment' =
    'code';
  let codeBuffer = '';

  const finishLine = (): void => {
    line += 1;
    codeBuffer = '';
  };

  while (index < source.length) {
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (character === '\r' && nextCharacter === '\n') {
      if (state === 'lineComment') {
        state = 'code';
      }
      finishLine();
      index += 2;
      continue;
    }
    if (character === '\n') {
      if (state === 'lineComment') {
        state = 'code';
      }
      finishLine();
      index += 1;
      continue;
    }

    if (state === 'lineComment' || state === 'blockComment') {
      if (state === 'blockComment' && character === '*' && nextCharacter === '/') {
        state = 'code';
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (state === 'singleQuote' || state === 'doubleQuote' || state === 'template') {
      if (character === '\\') {
        index += 2;
        continue;
      }
      const quote =
        state === 'singleQuote' ? "'" : state === 'doubleQuote' ? '"' : '`';
      if (character === quote) {
        state = 'code';
      }
      index += 1;
      continue;
    }

    if (character === '/' && nextCharacter === '/') {
      state = 'lineComment';
      index += 2;
      continue;
    }
    if (character === '/' && nextCharacter === '*') {
      state = 'blockComment';
      index += 2;
      continue;
    }

    if (character === "'" || character === '"') {
      if (CODE_IMPORT_PREFIX_PATTERN.test(codeBuffer)) {
        const specifier = readQuotedString(source, index);
        if (RELATIVE_SPECIFIER_PATTERN.test(specifier.value)) {
          imports.push({ line, specifier: specifier.value });
        }
        codeBuffer += '""';
        index = specifier.nextIndex;
        continue;
      }
      state = character === "'" ? 'singleQuote' : 'doubleQuote';
      index += 1;
      continue;
    }
    if (character === '`') {
      state = 'template';
      index += 1;
      continue;
    }

    codeBuffer += character;
    index += 1;
  }

  return imports;
}

function readQuotedString(
  source: string,
  startIndex: number,
): { value: string; nextIndex: number } {
  const quote = source[startIndex];
  let index = startIndex + 1;
  let value = '';
  while (index < source.length) {
    const character = source[index];
    if (character === '\\') {
      value += source[index + 1] ?? '';
      index += 2;
      continue;
    }
    if (character === quote) {
      return { value, nextIndex: index + 1 };
    }
    if (character === '\n') {
      return { value, nextIndex: index };
    }
    value += character;
    index += 1;
  }
  return { value, nextIndex: index };
}

function hasRuntimeExtension(specifier: string): boolean {
  return /\.(?:js|mjs|cjs|json|node)$/.test(specifier);
}

function blankStringLiterals(sourceLine: string): string {
  return sourceLine.replace(/(['"`])(?:\\.|[^\\])*?\1/g, '""');
}

function stripCommentsPreservingLines(source: string): string[] {
  const lines: string[] = [];
  let currentLine = '';
  let index = 0;
  let state: 'code' | 'singleQuote' | 'doubleQuote' | 'template' | 'lineComment' | 'blockComment' =
    'code';

  const finishLine = (): void => {
    lines.push(currentLine);
    currentLine = '';
  };

  while (index < source.length) {
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (character === '\r' && nextCharacter === '\n') {
      if (state === 'lineComment') {
        state = 'code';
      }
      finishLine();
      index += 2;
      continue;
    }

    if (character === '\n') {
      if (state === 'lineComment') {
        state = 'code';
      }
      finishLine();
      index += 1;
      continue;
    }

    if (state === 'lineComment' || state === 'blockComment') {
      if (state === 'blockComment' && character === '*' && nextCharacter === '/') {
        state = 'code';
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (state === 'singleQuote' || state === 'doubleQuote' || state === 'template') {
      if (character === '\\') {
        currentLine += character;
        currentLine += nextCharacter ?? '';
        index += 2;
        continue;
      }
      currentLine += character;
      const quote =
        state === 'singleQuote' ? "'" : state === 'doubleQuote' ? '"' : '`';
      if (character === quote) {
        state = 'code';
      }
      index += 1;
      continue;
    }

    if (character === '/' && nextCharacter === '/') {
      state = 'lineComment';
      index += 2;
      continue;
    }
    if (character === '/' && nextCharacter === '*') {
      state = 'blockComment';
      index += 2;
      continue;
    }
    if (character === "'") {
      state = 'singleQuote';
      currentLine += character;
      index += 1;
      continue;
    }
    if (character === '"') {
      state = 'doubleQuote';
      currentLine += character;
      index += 1;
      continue;
    }
    if (character === '`') {
      state = 'template';
      currentLine += character;
      index += 1;
      continue;
    }

    currentLine += character;
    index += 1;
  }

  lines.push(currentLine);
  return lines;
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

if (
  isDirectRun({
    moduleUrl: import.meta.url,
    moduleFilename: import.meta.filename,
    argv1: process.argv[1],
  })
) {
  main();
}
