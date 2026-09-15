import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { isDirectRun } from './is-direct-run.mjs';

const RUNTIME_EXTENSIONS = new Set(['.js', '.mjs']);
const RELATIVE_IMPORT_PATTERN =
  /(?:from\s+|import\s*(?:\(\s*)?)["'](\.{1,2}\/[^"']+)["']/g;

export function findArtifactViolations(files) {
  const violations = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    if (/\brequire\s*\(|\bmodule\.exports\b|\bexports\./.test(source)) {
      violations.push(`${file}: contains CommonJS runtime syntax`);
    }
    if (/\b__(?:dirname|filename)\b/.test(source)) {
      violations.push(`${file}: contains CommonJS path globals`);
    }
    for (const match of source.matchAll(RELATIVE_IMPORT_PATTERN)) {
      if (!/\.(?:js|mjs|cjs|json|node)$/.test(match[1])) {
        violations.push(`${file}: unresolved relative import ${match[1]}`);
      }
    }
  }
  return violations;
}

function collectJavaScriptFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJavaScriptFiles(entryPath));
    } else if (entry.isFile() && RUNTIME_EXTENSIONS.has(extname(entry.name))) {
      files.push(entryPath);
    }
  }
  return files;
}

export function verifyEsmArtifact(distDirectory) {
  const entryPoint = join(distDirectory, 'main.js');
  const files = collectJavaScriptFiles(distDirectory);
  const violations = findArtifactViolations(files);
  if (!files.some((file) => file === entryPoint)) {
    violations.unshift(`${entryPoint}: production ESM entry point is missing`);
  } else if (!/^\s*(?:import|export)\b/m.test(readFileSync(entryPoint, 'utf8'))) {
    violations.unshift(`${entryPoint}: does not contain native ESM syntax`);
  }
  return violations;
}

if (
  isDirectRun({
    moduleUrl: import.meta.url,
    moduleFilename: import.meta.filename,
    argv1: process.argv[1],
  })
) {
  const violations = verifyEsmArtifact(join(import.meta.dirname, '..', 'dist'));
  if (violations.length > 0) {
    console.error(violations.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('Production ESM artifact passed.');
  }
}
