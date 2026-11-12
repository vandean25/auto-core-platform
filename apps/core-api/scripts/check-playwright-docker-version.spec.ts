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
const NVMRC_PATH = path.join(REPO_ROOT, '.nvmrc');
const CURSOR_DOCKERFILE_PATH = path.join(REPO_ROOT, '.cursor', 'Dockerfile');
const CLOUDBUILD_STAGING_PATH = path.join(REPO_ROOT, 'cloudbuild.staging.yaml');
const AGENTS_MD_PATH = path.join(REPO_ROOT, 'agents.md');
const VERIFY_SCRIPT_PATH = path.join(
  CORE_API_ROOT,
  'scripts',
  'verify-pdf-worker-node.sh',
);
const NODE_SLIM_DIGEST =
  'sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54';

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

function readNvmrcVersion(): string {
  return fs.readFileSync(NVMRC_PATH, 'utf8').trim();
}

function splitDockerStages(dockerfile: string): {
  builder: string;
  worker: string;
  rest: string;
} {
  const workerSplit = dockerfile.split(/^FROM mcr\.microsoft\.com\/playwright:/m);
  const builder = workerSplit[0] ?? '';
  const afterWorker = workerSplit[1] ?? '';
  const workerMatch = afterWorker.match(
    /^[\s\S]*?^FROM node:[^\n]+ AS api$/m,
  );
  const worker = workerMatch
    ? workerMatch[0].replace(/^FROM node:[^\n]+ AS api$/m, '').trimEnd()
    : afterWorker;
  return { builder, worker, rest: afterWorker };
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

  it('keeps every listed Node pin identical to .nvmrc (AUT-991 scenario 1)', () => {
    const expected = readNvmrcVersion();
    const dockerfile = fs.readFileSync(DOCKERFILE_PATH, 'utf8');
    const cursorDockerfile = fs.readFileSync(CURSOR_DOCKERFILE_PATH, 'utf8');
    const cloudBuild = fs.readFileSync(CLOUDBUILD_PATH, 'utf8');
    const cloudBuildStaging = fs.readFileSync(CLOUDBUILD_STAGING_PATH, 'utf8');
    const verifyScript = fs.readFileSync(VERIFY_SCRIPT_PATH, 'utf8');
    const agentsMd = fs.readFileSync(AGENTS_MD_PATH, 'utf8');

    expect(expected).toBe('24.22.3');
    const builderPin = dockerfile.match(
      /^FROM node:([0-9.]+)-slim@sha256:[a-f0-9]{64} AS builder$/m,
    );
    const apiPin = dockerfile.match(
      /^FROM node:([0-9.]+)-slim@sha256:[a-f0-9]{64} AS api$/m,
    );
    const pdfWorkerArg = dockerfile.match(/^ARG PDF_WORKER_NODE_VERSION=([0-9.]+)/m);
    expect(builderPin?.[1]).toBe(expected);
    expect(apiPin?.[1]).toBe(expected);
    expect(pdfWorkerArg?.[1]).toBe(expected);
    const cursorNodeArgs = [
      ...cursorDockerfile.matchAll(/^ARG NODE_VERSION=([0-9.]+)$/gm),
    ].map((match) => match[1]);
    expect(cursorNodeArgs).toEqual([expected, expected]);
    const cloudBuildPins = [
      ...cloudBuild.matchAll(/^\s*name: node:([0-9.]+)\s*$/gm),
    ].map((match) => match[1]);
    expect(cloudBuildPins).toEqual([expected, expected]);
    const stagingPin = cloudBuildStaging.match(/^\s*name: node:([0-9.]+)\s*$/m);
    expect(stagingPin?.[1]).toBe(expected);
    expect(verifyScript).toContain(`PDF_WORKER_NODE_VERSION:-${expected}`);
    expect(agentsMd).toContain(`**${expected}** from`);
  });

  it('requires digest-pinned node stages for builder and api (AUT-991 scenario 2)', () => {
    const expected = readNvmrcVersion();
    const dockerfile = fs.readFileSync(DOCKERFILE_PATH, 'utf8');

    expect(dockerfile).toMatch(
      /^FROM node:[0-9.]+-slim@sha256:[a-f0-9]{64} AS builder$/m,
    );
    expect(dockerfile).toMatch(
      /^FROM node:[0-9.]+-slim@sha256:[a-f0-9]{64} AS api$/m,
    );
    expect(dockerfile).toContain(NODE_SLIM_DIGEST);
    expect(dockerfile).not.toMatch(/^FROM node:[0-9.]+-slim AS (builder|api)$/m);
    const taggedOnlyStages = [
      ...dockerfile.matchAll(/^FROM node:([0-9.]+)-slim AS (builder|api)$/gm),
    ];
    expect(taggedOnlyStages).toHaveLength(0);
    const builderPin = dockerfile.match(
      /^FROM node:([0-9.]+)-slim@sha256:[a-f0-9]{64} AS builder$/m,
    );
    const apiPin = dockerfile.match(
      /^FROM node:([0-9.]+)-slim@sha256:[a-f0-9]{64} AS api$/m,
    );
    expect(builderPin?.[1]).toBe(expected);
    expect(apiPin?.[1]).toBe(expected);
  });

  it('bans apt-get only in the worker stage and copies Node from pinned builder (AUT-991 scenario 3)', () => {
    const dockerfile = fs.readFileSync(DOCKERFILE_PATH, 'utf8');
    const { builder, worker } = splitDockerStages(dockerfile);

    expect(dockerfile).toMatch(/COPY --from=builder \/usr\/local\/bin\//);
    expect(dockerfile).toMatch(/COPY --from=builder \/usr\/local\/include\//);
    expect(dockerfile).toMatch(/COPY --from=builder \/usr\/local\/lib\//);
    expect(dockerfile).toMatch(/verify-pdf-worker-node\.sh/);
    expect(dockerfile).not.toMatch(/setup_24\.x/);
    expect(worker).not.toMatch(/apt-get/);
    expect(worker).not.toMatch(/sha256sum -c -/);
    expect(worker).not.toMatch(/node-v\$\{PDF_WORKER_NODE_VERSION\}-linux-x64\.tar/);
    // Non-worker stages are not subject to the worker apt ban guard.
    expect(builder.length).toBeGreaterThan(0);
    const verifyScript = fs.readFileSync(VERIFY_SCRIPT_PATH, 'utf8');
    expect(verifyScript).toMatch(
      /process\.versions\.node\.split\('\.'\)\.map\(Number\)/,
    );
  });

  it('declares a CI job that builds the pdf-worker image and runs smoke', () => {
    const workflow = fs.readFileSync(BUILD_WORKFLOW_PATH, 'utf8');
    expect(workflow).toMatch(/^\s*pdf-worker-image:/m);
    expect(workflow).toMatch(/--target worker/);
    expect(workflow).toMatch(/pdf-worker-image-smoke\.mjs/);
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
