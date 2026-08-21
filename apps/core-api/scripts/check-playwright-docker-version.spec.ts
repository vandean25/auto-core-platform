import * as fs from 'node:fs';
import * as path from 'node:path';

const CORE_API_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(CORE_API_ROOT, '../..');
const LOCKFILE_PATH = path.join(REPO_ROOT, 'package-lock.json');
const DOCKERFILE_PATH = path.join(CORE_API_ROOT, 'Dockerfile');
const CLOUDBUILD_PATH = path.join(REPO_ROOT, 'cloudbuild.yaml');

interface PackageManifest {
  engines?: {
    node?: string;
  };
}

interface Lockfile {
  packages?: Record<string, { version?: string }>;
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function readPlaywrightVersionFromLockfile(): string {
  const lockfile = readJsonFile<Lockfile>(LOCKFILE_PATH);
  const version = lockfile.packages?.['node_modules/playwright']?.version;
  if (!version) {
    throw new Error('Could not find playwright version in package-lock.json');
  }
  return version;
}

function readPlaywrightDockerTag(): string {
  const dockerfile = fs.readFileSync(DOCKERFILE_PATH, 'utf8');
  const match = dockerfile.match(
    /^FROM mcr\.microsoft\.com\/playwright:v([0-9.]+)-jammy AS worker$/m,
  );
  if (!match) {
    throw new Error(
      'Could not find the pinned Playwright worker image in Dockerfile',
    );
  }
  return match[1];
}

function readEngineVersion(manifestPath: string): string {
  const manifest = readJsonFile<PackageManifest>(manifestPath);
  const version = manifest.engines?.node;
  if (!version) {
    throw new Error(`Could not find engines.node in ${manifestPath}`);
  }
  return version;
}

describe('Production image version pins (AUT-167)', () => {
  it('matches the playwright package version in package-lock.json', () => {
    const packageVersion = readPlaywrightVersionFromLockfile();
    const dockerTagVersion = readPlaywrightDockerTag();
    expect(dockerTagVersion).toBe(packageVersion);
  });

  it('uses Node 22 slim for the API target', () => {
    const dockerfile = fs.readFileSync(DOCKERFILE_PATH, 'utf8');

    expect(dockerfile).toMatch(/^FROM node:22-slim AS api$/m);
  });

  it('uses Node 22 in Cloud Build', () => {
    const cloudBuild = fs.readFileSync(CLOUDBUILD_PATH, 'utf8');

    expect(cloudBuild).toMatch(/^\s*name: node:22\s*$/m);
  });

  it('requires Node 22 in the root engine declaration', () => {
    const rootNodeVersion = readEngineVersion(
      path.join(REPO_ROOT, 'package.json'),
    );

    expect(rootNodeVersion).toBe('>=22');
  });

  it('requires Node 22 in the API engine declaration', () => {
    const apiNodeVersion = readEngineVersion(
      path.join(CORE_API_ROOT, 'package.json'),
    );

    expect(apiNodeVersion).toBe('>=22');
  });
});
