import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { isDirectRun } from './is-direct-run.mjs';

describe('isDirectRun', () => {
  it('returns false when argv1 is missing', () => {
    expect(
      isDirectRun({
        moduleUrl: 'file:///tmp/cli.mjs',
        moduleFilename: '/tmp/cli.mjs',
      }),
    ).toBe(false);
  });

  it('returns true when argv1 equals the module filename', () => {
    expect(
      isDirectRun({
        moduleUrl: 'file:///tmp/cli.mjs',
        moduleFilename: '/tmp/cli.mjs',
        argv1: '/tmp/cli.mjs',
      }),
    ).toBe(true);
  });

  it('returns true when a relative argv1 resolves to the module filename', () => {
    const moduleFilename = join(process.cwd(), 'scripts', 'check-esm-contract.ts');

    expect(
      isDirectRun({
        moduleUrl: pathToFileURL(moduleFilename).href,
        moduleFilename,
        argv1: join('scripts', 'check-esm-contract.ts'),
      }),
    ).toBe(true);
  });

  it('returns false when argv1 points at a different program', () => {
    expect(
      isDirectRun({
        moduleUrl: 'file:///tmp/cli.mjs',
        moduleFilename: '/tmp/cli.mjs',
        argv1: '/tmp/node_modules/jest/bin/jest.js',
      }),
    ).toBe(false);
  });
});
