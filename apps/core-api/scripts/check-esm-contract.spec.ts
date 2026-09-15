import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import {
  collectMaintainedRuntimeFiles,
  findEsmContractViolations,
} from './check-esm-contract.js';

const tempDirectories: string[] = [];

function createSourceDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'core-api-esm-source-'));
  tempDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('findEsmContractViolations', () => {
  it('accepts explicit JavaScript extensions and native ESM APIs', () => {
    const violations = findEsmContractViolations([
      {
        filePath: 'src/example.ts',
        source: "import { value } from './value.js';\nconst directory = import.meta.dirname;",
      },
    ]);

    expect(violations).toEqual([]);
  });

  it('reports extensionless relative imports and CommonJS runtime APIs', () => {
    const violations = findEsmContractViolations([
      {
        filePath: 'src/example.ts',
        source:
          "import { value } from './value';\nconst loaded = require('./other.js');\nmodule.exports = loaded;",
      },
    ]);

    expect(violations).toEqual([
      {
        filePath: 'src/example.ts',
        line: 1,
        message: 'Relative import must include an explicit runtime extension: ./value',
      },
      {
        filePath: 'src/example.ts',
        line: 2,
        message: 'CommonJS require() is not allowed in maintained ESM runtime code',
      },
      {
        filePath: 'src/example.ts',
        line: 3,
        message: 'CommonJS module.exports/exports is not allowed in maintained ESM runtime code',
      },
    ]);
  });

  it('reports every extensionless relative import on the same line', () => {
    const violations = findEsmContractViolations([
      {
        filePath: 'src/example.ts',
        source: "import { value } from './value'; import { other } from './other';",
      },
    ]);

    expect(violations).toEqual([
      {
        filePath: 'src/example.ts',
        line: 1,
        message: 'Relative import must include an explicit runtime extension: ./value',
      },
      {
        filePath: 'src/example.ts',
        line: 1,
        message: 'Relative import must include an explicit runtime extension: ./other',
      },
    ]);
  });

  it('reports CommonJS path globals and createRequire()', () => {
    const violations = findEsmContractViolations([
      {
        filePath: 'src/example.ts',
        source:
          "const directory = __dirname;\nconst loaded = createRequire(import.meta.url)('./legacy.cjs');",
      },
    ]);

    expect(violations).toEqual([
      {
        filePath: 'src/example.ts',
        line: 1,
        message: 'CommonJS __dirname/__filename is not allowed in maintained ESM runtime code',
      },
      {
        filePath: 'src/example.ts',
        line: 2,
        message: 'CommonJS createRequire() is not allowed in maintained ESM runtime code',
      },
    ]);
  });

  it('ignores comments when checking runtime patterns', () => {
    const violations = findEsmContractViolations([
      {
        filePath: 'src/example.ts',
        source: '// require("legacy")\n/* module.exports = legacy */',
      },
    ]);

    expect(violations).toEqual([]);
  });

  it('ignores import-like text inside string literals', () => {
    const violations = findEsmContractViolations([
      {
        filePath: 'src/example.ts',
        source: `const snippet = "import { value } from './value'";`,
      },
    ]);

    expect(violations).toEqual([]);
  });

  it('ignores CommonJS patterns inside multi-line block comments', () => {
    const violations = findEsmContractViolations([
      {
        filePath: 'src/example.ts',
        source: '/*\nrequire("legacy")\nmodule.exports = legacy\n__dirname\n*/',
      },
    ]);

    expect(violations).toEqual([]);
  });
});

describe('collectMaintainedRuntimeFiles', () => {
  it('includes spec files in the maintained runtime scan', () => {
    const directory = createSourceDirectory();
    writeFileSync(join(directory, 'example.spec.ts'), "const loaded = require('./legacy.js');\n");

    const files = collectMaintainedRuntimeFiles(directory);

    expect(files).toEqual([
      {
        filePath: 'example.spec.ts',
        source: "const loaded = require('./legacy.js');\n",
      },
    ]);
    expect(findEsmContractViolations(files)).toEqual([
      {
        filePath: 'example.spec.ts',
        line: 1,
        message: 'CommonJS require() is not allowed in maintained ESM runtime code',
      },
    ]);
  });
});
