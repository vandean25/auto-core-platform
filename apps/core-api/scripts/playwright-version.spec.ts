import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type PackageManifest = {
  dependencies?: Record<string, string>;
};

type Lockfile = {
  packages: Record<string, { dependencies?: Record<string, string>; version?: string }>;
};

describe('Playwright runtime version', () => {
  it('keeps the npm package, lockfile, and runner image on one version', () => {
    const packageManifest = readJson<PackageManifest>(
      join(__dirname, '../package.json'),
    );
    const lockfile = readJson<Lockfile>(
      join(__dirname, '../../../package-lock.json'),
    );
    const dockerfile = readFileSync(join(__dirname, '../Dockerfile'), 'utf8');

    const packageVersion = packageManifest.dependencies?.playwright;
    const lockfileVersion = lockfile.packages['node_modules/playwright']?.version;
    const imageVersion = dockerfile.match(
      /mcr\.microsoft\.com\/playwright:v([0-9]+\.[0-9]+\.[0-9]+)-jammy/,
    )?.[1];

    expect(packageVersion).toBe('1.62.1');
    expect(lockfileVersion).toBe('1.62.1');
    expect(imageVersion).toBe('1.62.1');
  });
});

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
