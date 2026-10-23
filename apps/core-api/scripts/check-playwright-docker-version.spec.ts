import * as fs from 'node:fs';
import * as path from 'node:path';

const CORE_API_ROOT = path.resolve(import.meta.dirname, '..');
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
  const version =
    lockfile.packages?.['apps/core-api/node_modules/playwright']?.version ??
    lockfile.packages?.['node_modules/playwright']?.version;
  if (!version) {
    throw new Error('Could not find playwright version in package-lock.json');
  }
  return version;
}

function readPlaywrightDockerTag(): string {
  const dockerfile = fs.readFileSync(DOCKERFILE_PATH, 'utf8');
  const match = dockerfile.match(
    /^FROM mcr\.microsoft\.com\/playwright:v([0-9.]+)-noble AS worker$/m,
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

  it('copies repo-root locales into the builder stage after npm ci', () => {
    const dockerfile = fs.readFileSync(DOCKERFILE_PATH, 'utf8');
    const builderStage = dockerfile.split(
      /^FROM mcr\.microsoft\.com\/playwright:/m,
    )[0];

    expect(builderStage).toMatch(/^COPY locales \.\/locales$/m);
    const npmCiIndex = builderStage.indexOf('npm ci');
    const copyLocalesIndex = builderStage.indexOf('COPY locales ./locales');
    const buildIndex = builderStage.indexOf('npm run build');
    expect(copyLocalesIndex).toBeGreaterThan(npmCiIndex);
    expect(buildIndex).toBeGreaterThan(copyLocalesIndex);
  });

  it('fails the builder when dist/locales is missing after build', () => {
    const dockerfile = fs.readFileSync(DOCKERFILE_PATH, 'utf8');
    const builderStage = dockerfile.split(
      /^FROM mcr\.microsoft\.com\/playwright:/m,
    )[0];

    expect(builderStage).toMatch(/^RUN test -d dist\/locales$/m);
  });

  it('fails the builder when dist/locales/de/seedMaster.json is missing after build', () => {
    const dockerfile = fs.readFileSync(DOCKERFILE_PATH, 'utf8');
    const builderStage = dockerfile.split(
      /^FROM mcr\.microsoft\.com\/playwright:/m,
    )[0];

    expect(builderStage).toMatch(
      /^RUN test -f dist\/locales\/de\/seedMaster\.json$/m,
    );
  });

  it('uses Node 24.22.1 slim for the API target', () => {
    const dockerfile = fs.readFileSync(DOCKERFILE_PATH, 'utf8');

    expect(dockerfile).toMatch(
      /^FROM node:24\.22\.1-slim(@sha256:[a-f0-9]{64})? AS api$/m,
    );
  });

  it('uses Node 24.22.1 in Cloud Build', () => {
    const cloudBuild = fs.readFileSync(CLOUDBUILD_PATH, 'utf8');

    expect(cloudBuild).toMatch(/^\s*name: node:24\.22\.1\s*$/m);
  });

  it('fails the worker image build when Node is below 24.22.1', () => {
    const dockerfile = fs.readFileSync(DOCKERFILE_PATH, 'utf8');

    expect(dockerfile).toMatch(
      /process\.versions\.node\.split\('\.'\)\.map\(Number\)/,
    );
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
