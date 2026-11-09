import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGISTERED_CATALOG_ITEM_WRITER_PATHS } from './catalog-item-revision-writers.inventory.js';

const SRC_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CATALOG_WRITE_CALL =
  /\bcatalogItem\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

function isScanned(file: string): boolean {
  const name = relative(SRC_ROOT, file);
  return (
    name.endsWith('.ts') &&
    !/\.spec(\.support)?\.ts$/.test(name) &&
    !name.endsWith('.test.ts') &&
    name !== 'inventory/catalog-item-revision-writers.spec.ts' &&
    name !== 'inventory/catalog-item-revision-writers.inventory.ts'
  );
}

function findCatalogWrites(source: string): number {
  return [...source.matchAll(CATALOG_WRITE_CALL)].length;
}

describe('catalog-item-revision-writers', () => {
  it('unregistered writer fails', () => {
    const writers = sourceFiles(SRC_ROOT)
      .filter(isScanned)
      .filter((file) => findCatalogWrites(readFileSync(file, 'utf8')) > 0)
      .map((file) => relative(SRC_ROOT, file))
      .sort();

    expect(writers).toEqual([...REGISTERED_CATALOG_ITEM_WRITER_PATHS].sort());
  });
});
