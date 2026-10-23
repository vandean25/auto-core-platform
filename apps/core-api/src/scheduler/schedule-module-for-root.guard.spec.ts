import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_ROOT = fileURLToPath(new URL('..', import.meta.url));
const FOR_ROOT_PATTERN = /ScheduleModule\.forRoot\(/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

function isScannedSource(file: string): boolean {
  const name = relative(SRC_ROOT, file);
  return (
    name.endsWith('.ts') &&
    !name.endsWith('.spec.ts') &&
    !name.endsWith('.spec.support.ts')
  );
}

describe('ScheduleModule.forRoot registration', () => {
  it('is registered exactly once under apps/core-api/src', () => {
    const matches = sourceFiles(SRC_ROOT)
      .filter(isScannedSource)
      .flatMap((file) => {
        const source = readFileSync(file, 'utf8');
        const count = [...source.matchAll(FOR_ROOT_PATTERN)].length;
        return count > 0 ? [{ file: relative(SRC_ROOT, file), count }] : [];
      });

    const total = matches.reduce((sum, entry) => sum + entry.count, 0);
    expect(total).toBe(1);
    expect(matches).toEqual([{ file: 'app.module.ts', count: 1 }]);
  });
});
