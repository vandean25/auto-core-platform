import * as fs from 'node:fs';
import * as path from 'node:path';

const CORE_API_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(CORE_API_ROOT, '../..');

function readPlaywrightVersionFromLockfile(): string {
  const lockfile = fs.readFileSync(
    path.join(REPO_ROOT, 'package-lock.json'),
    'utf8',
  );
  const match = lockfile.match(
    /"node_modules\/playwright":\s*\{[^}]*"version":\s*"([^"]+)"/,
  );
  if (!match) {
    throw new Error('Could not find playwright version in package-lock.json');
  }
  return match[1];
}

function readPlaywrightDockerTag(): string {
  const dockerfile = fs.readFileSync(
    path.join(CORE_API_ROOT, 'Dockerfile'),
    'utf8',
  );
  const match = dockerfile.match(
    /mcr\.microsoft\.com\/playwright:v([0-9.]+)-jammy/,
  );
  if (!match) {
    throw new Error('Could not find Playwright Docker image tag in Dockerfile');
  }
  return match[1];
}

describe('Playwright Docker image version pin (AUT-161)', () => {
  it('matches the playwright package version in package-lock.json', () => {
    const packageVersion = readPlaywrightVersionFromLockfile();
    const dockerTagVersion = readPlaywrightDockerTag();
    expect(dockerTagVersion).toBe(packageVersion);
  });
});
