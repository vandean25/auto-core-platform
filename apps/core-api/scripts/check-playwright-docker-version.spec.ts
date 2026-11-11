import * as fs from 'node:fs';
import * as path from 'node:path';

const CORE_API_ROOT = path.resolve(import.meta.dirname, '..');
const REPO_ROOT = path.resolve(CORE_API_ROOT, '../..');
const LOCKFILE_PATH = path.join(REPO_ROOT, 'package-lock.json');
const DOCKERFILE_PATH = path.join(CORE_API_ROOT, 'Dockerfile');
const CLOUDBUILD_PATH = path.join(REPO_ROOT, 'cloudbuild.yaml');
const BUILD_WORKFLOW_PATH = path.join(
  REPO_ROOT,
  '.github',
  'workflows',
  'build.yaml',
);
const FULLSTACK_WORKFLOW_PATH = path.join(
  REPO_ROOT,
  '.github',
  'workflows',
  'e2e-fullstack.yaml',
);

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
    /^FROM mcr\.microsoft\.com\/playwright:v([0-9.]+)-noble(@sha256:[a-f0-9]{64}) AS worker$/m,
  );
  if (!match) {
    throw new Error(
      'Could not find the pinned Playwright worker image in Dockerfile',
    );
  }
  return match[1];
}

function readBundledChromiumVersion(playwrightVersion: string): string {
  const browsersPath = path.join(
    REPO_ROOT,
    'node_modules',
    'playwright-core',
    'browsers.json',
  );
  if (!fs.existsSync(browsersPath)) {
    throw new Error(
      `Missing ${browsersPath}; run npm ci before check-playwright-docker-version tests.`,
    );
  }
  const manifest = readJsonFile<{
    browsers: Array<{ name: string; browserVersion?: string }>;
  }>(browsersPath);
  const chromium = manifest.browsers.find((entry) => entry.name === 'chromium');
  if (!chromium?.browserVersion) {
    throw new Error('Could not read bundled Chromium version from browsers.json');
  }
  if (playwrightVersion !== readPlaywrightVersionFromLockfile()) {
    throw new Error('Playwright version drifted while reading browsers.json');
  }
  return chromium.browserVersion;
}

function parseChromiumVersion(version: string): number[] {
  return version.split('.').map((part) => Number(part));
}

function isChromiumAtLeast(
  version: string,
  minimum: readonly [number, number, number, number],
): boolean {
  const parts = parseChromiumVersion(version);
  for (let index = 0; index < minimum.length; index += 1) {
    const current = parts[index] ?? 0;
    const min = minimum[index] ?? 0;
    if (current > min) {
      return true;
    }
    if (current < min) {
      return false;
    }
  }
  return true;
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

  it('bundles Chromium at or above 157.0.8103.50 (CVE-2026-125350)', () => {
    const packageVersion = readPlaywrightVersionFromLockfile();
    const chromiumVersion = readBundledChromiumVersion(packageVersion);
    expect(isChromiumAtLeast(chromiumVersion, [157, 0, 8103, 50])).toBe(true);
  });

  it('pins every Playwright CI job container to the lockfile version', () => {
    const workflow = fs.readFileSync(BUILD_WORKFLOW_PATH, 'utf8');
    const tags = [
      ...workflow.matchAll(
        /^\s*image: mcr\.microsoft\.com\/playwright:v([0-9.]+)-noble\s*$/gm,
      ),
    ].map((match) => match[1]);

    // frontend-e2e and backend-e2e
    expect(tags).toHaveLength(2);
    for (const tag of tags) {
      expect(tag).toBe(readPlaywrightVersionFromLockfile());
    }
  });

  it('pins the nightly full-stack Playwright harness container to the lockfile version', () => {
    const workflow = fs.readFileSync(FULLSTACK_WORKFLOW_PATH, 'utf8');
    const tags = [
      ...workflow.matchAll(
        /^\s*image: mcr\.microsoft\.com\/playwright:v([0-9.]+)-noble\s*$/gm,
      ),
    ].map((match) => match[1]);

    expect(tags).toHaveLength(1);
    expect(tags[0]).toBe(readPlaywrightVersionFromLockfile());
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

  it('uses Node 24.22.2 slim for the API target', () => {
    const dockerfile = fs.readFileSync(DOCKERFILE_PATH, 'utf8');

    expect(dockerfile).toMatch(
      /^FROM node:24\.22\.2-slim(@sha256:[a-f0-9]{64})? AS api$/m,
    );
  });

  it('uses Node 24.22.2 in Cloud Build', () => {
    const cloudBuild = fs.readFileSync(CLOUDBUILD_PATH, 'utf8');

    expect(cloudBuild).toMatch(/^\s*name: node:24\.22\.2\s*$/m);
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
