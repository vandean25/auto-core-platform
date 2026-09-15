import { describe, expect, it } from '@jest/globals';
import { findEsmContractViolations } from './check-esm-contract.js';

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

  it('ignores comments when checking runtime patterns', () => {
    const violations = findEsmContractViolations([
      {
        filePath: 'src/example.ts',
        source: '// require("legacy")\n/* module.exports = legacy */',
      },
    ]);

    expect(violations).toEqual([]);
  });
});
