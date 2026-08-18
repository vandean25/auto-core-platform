import * as fs from 'node:fs';
import * as path from 'node:path';

const CORE_API_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(CORE_API_ROOT, '../..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function extractGithubJob(workflow: string, jobId: string): string {
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${jobId}:`);
  if (start < 0) {
    throw new Error(`GitHub job '${jobId}' not found`);
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z0-9_-]+:\s*$/.test(lines[index])) {
      end = index;
      break;
    }
  }

  return lines.slice(start, end).join('\n');
}

const workflow = readRepoFile('.github/workflows/build.yaml');
const backendJob = extractGithubJob(workflow, 'backend');

describe('npm workspaces (AUT-140)', () => {
  const rootPackage = JSON.parse(readRepoFile('package.json')) as {
    workspaces?: string[];
    scripts?: Record<string, string>;
  };

  it('declares apps/* workspaces at the repo root', () => {
    expect(rootPackage.workspaces).toEqual(['apps/*']);
  });

  it('exposes root lint, test, build, and ci scripts across workspaces', () => {
    expect(rootPackage.scripts?.lint).toContain('--workspaces');
    expect(rootPackage.scripts?.test).toContain('--workspaces');
    expect(rootPackage.scripts?.build).toContain('--workspaces');
    expect(rootPackage.scripts?.ci).toBe(
      'npm run lint && npm test && npm run build',
    );
  });

  it('installs the backend job from the root lockfile', () => {
    expect(backendJob).toContain('cache-dependency-path: package-lock.json');
    expect(backendJob).toMatch(/^        run: npm ci$/m);
  });
});

describe('backend PR CI ESLint (AUT-131)', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(CORE_API_ROOT, 'package.json'), 'utf8'),
  ) as { scripts: Record<string, string> };
  const eslintConfig = fs.readFileSync(
    path.join(CORE_API_ROOT, 'eslint.config.mjs'),
    'utf8',
  );

  it('runs npm run lint in the backend job', () => {
    expect(backendJob).toMatch(
      /^        run: npm run lint --workspace=core-api$/m,
    );
  });

  it('still runs tenant unique-constraint lint', () => {
    expect(backendJob).toMatch(
      /^        run: npm run lint:prisma-tenant --workspace=core-api$/m,
    );
  });

  it('does not auto-fix when linting', () => {
    expect(packageJson.scripts.lint).not.toMatch(/--fix/);
  });

  it('bans Prisma raw query methods via no-restricted-syntax', () => {
    expect(eslintConfig).toContain("property.name='$queryRaw'");
    expect(eslintConfig).toContain("property.name='$queryRawUnsafe'");
    expect(eslintConfig).toContain("property.name='$executeRaw'");
    expect(eslintConfig).toContain("property.name='$executeRawUnsafe'");
  });

  it('does not disable no-restricted-syntax for src application code', () => {
    const exemptionMatch = eslintConfig.match(
      /files:\s*\[([\s\S]*?)\]\s*,\s*rules:\s*\{[\s\S]*?no-restricted-syntax['"]:\s*'off'/,
    );

    expect(exemptionMatch).not.toBeNull();
    const exemptFiles = exemptionMatch?.[1] ?? '';
    expect(exemptFiles).not.toContain("'src/");
    expect(exemptFiles).not.toContain('"src/');
  });
});
