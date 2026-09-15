import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { findArtifactViolations, verifyEsmArtifact } from './verify-esm-artifact.mjs';

const tempDirectories: string[] = [];

function createArtifactDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'core-api-esm-'));
  tempDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('verifyEsmArtifact', () => {
  it('accepts a native ESM artifact with explicit relative extensions', () => {
    const directory = createArtifactDirectory();
    writeFileSync(join(directory, 'main.js'), "import './app.js';\nexport {};\n");
    writeFileSync(join(directory, 'app.js'), 'export const app = true;\n');

    expect(verifyEsmArtifact(directory)).toEqual([]);
  });

  it('reports unresolved imports and CommonJS syntax', () => {
    const directory = createArtifactDirectory();
    writeFileSync(join(directory, 'main.js'), "import './app';\nconst app = require('./app.js');\n");

    expect(findArtifactViolations([join(directory, 'main.js')])).toEqual([
      `${join(directory, 'main.js')}: contains CommonJS runtime syntax`,
      `${join(directory, 'main.js')}: unresolved relative import ./app`,
    ]);
    expect(verifyEsmArtifact(directory)).toEqual([
      `${join(directory, 'main.js')}: contains CommonJS runtime syntax`,
      `${join(directory, 'main.js')}: unresolved relative import ./app`,
    ]);
  });

  it('reports legacy CommonJS path globals in emitted code', () => {
    const directory = createArtifactDirectory();
    const filePath = join(directory, 'legacy.js');
    writeFileSync(filePath, 'console.log(__dirname);');

    expect(findArtifactViolations([filePath])).toEqual([
      `${filePath}: contains CommonJS path globals`,
    ]);
  });

  it('reports a missing production ESM entry point', () => {
    const directory = createArtifactDirectory();
    writeFileSync(join(directory, 'app.js'), 'export const app = true;\n');

    expect(verifyEsmArtifact(directory)).toEqual([
      `${join(directory, 'main.js')}: production ESM entry point is missing`,
    ]);
  });
});
