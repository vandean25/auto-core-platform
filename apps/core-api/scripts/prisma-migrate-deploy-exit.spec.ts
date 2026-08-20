import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  P3005_BASELINE_HINT,
  resolveCloudBuildMigrateExit,
  runPrismaMigrateDeployCli,
} from './prisma-migrate-deploy-exit';

const P3005_LOG = `
Error: P3005

The database schema is not empty. Read more about how to baseline an existing production database: https://pris.ly/d/migrate-baseline
`.trim();

const P3009_LOG = `
Error: P3009

migrate found failed migrations in the target database, new migrations will not be applied.
`.trim();

const P1001_LOG = `
Error: P1001

Can't reach database server at \`db.example.com:5432\`
`.trim();

describe('resolveCloudBuildMigrateExit', () => {
  it('returns 0 when prisma migrate deploy exits 0', () => {
    expect(resolveCloudBuildMigrateExit(0, 'No pending migrations to apply.')).toEqual({
      exitCode: 0,
    });
  });

  it('returns prisma exit 0 even if output mentions P3005', () => {
    expect(resolveCloudBuildMigrateExit(0, P3005_LOG).exitCode).toBe(0);
  });

  it('fails with prisma exit code when output contains P3005', () => {
    expect(resolveCloudBuildMigrateExit(1, P3005_LOG).exitCode).toBe(1);
  });

  it('preserves a non-1 prisma exit code on P3005', () => {
    expect(resolveCloudBuildMigrateExit(2, P3005_LOG).exitCode).toBe(2);
  });

  it('fails on P3009 and does not treat it as a skip', () => {
    expect(resolveCloudBuildMigrateExit(1, P3009_LOG).exitCode).toBe(1);
  });

  it('fails on other Prisma errors such as P1001', () => {
    expect(resolveCloudBuildMigrateExit(1, P1001_LOG).exitCode).toBe(1);
  });

  it('includes a one-shot baseline hint when P3005 fails the deploy', () => {
    expect(resolveCloudBuildMigrateExit(1, P3005_LOG).message).toBe(
      P3005_BASELINE_HINT,
    );
  });
});

describe('runPrismaMigrateDeployCli', () => {
  it('exits 0 and prints prisma output on a successful migrate deploy', () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = runPrismaMigrateDeployCli(
      () => ({ status: 0, output: 'No pending migrations to apply.\n' }),
      (text) => stdout.push(text),
      (text) => stderr.push(text),
    );

    expect(exitCode).toBe(0);
    expect(stdout).toEqual(['No pending migrations to apply.\n']);
    expect(stderr).toEqual([]);
  });

  it('exits non-zero for P3005 fixture logs and does not skip', () => {
    const stderr: string[] = [];

    const exitCode = runPrismaMigrateDeployCli(
      () => ({ status: 1, output: P3005_LOG }),
      () => undefined,
      (text) => stderr.push(text),
    );

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([P3005_BASELINE_HINT]);
  });

  it('exits non-zero for other Prisma fixture logs such as P3009', () => {
    const exitCode = runPrismaMigrateDeployCli(
      () => ({ status: 1, output: P3009_LOG }),
      () => undefined,
      () => undefined,
    );

    expect(exitCode).toBe(1);
  });

  it('writes spawn failures to stderr and exits non-zero', () => {
    const stderr: string[] = [];

    const exitCode = runPrismaMigrateDeployCli(
      () => ({
        status: null,
        output: '',
        error: new Error('spawn npx ENOENT'),
      }),
      () => undefined,
      (text) => stderr.push(text),
    );

    expect(exitCode).toBe(1);
    expect(stderr).toEqual(['spawn npx ENOENT']);
  });
});

describe('cloudbuild.yaml migrate-db', () => {
  const yaml = fs.readFileSync(
    path.join(__dirname, '../../../cloudbuild.yaml'),
    'utf8',
  );
  const migrateStep = extractStep(yaml, 'migrate-db');

  it('does not skip Prisma P3005', () => {
    expect(migrateStep).not.toMatch(/grep\s+-q\s+["']?P3005["']?/);
    expect(migrateStep).not.toMatch(/Skipping migrate deploy/);
  });

  it('explains that baseline is a manual one-shot operation', () => {
    expect(migrateStep).toMatch(/one-shot/i);
    expect(migrateStep).toMatch(/manual/i);
  });

  it('does not disable errexit around migrate deploy', () => {
    expect(migrateStep).not.toMatch(/set \+e/);
  });

  it('runs migrate deploy through the fail-closed helper', () => {
    expect(migrateStep).toMatch(/scripts\/prisma-migrate-deploy-exit\.ts/);
  });

  it('does not run the one-shot baseline script', () => {
    expect(migrateStep).not.toMatch(/baseline-prisma-migrations\.ts/);
  });
});

describe('prisma-migrate-deploy-exit spawn', () => {
  it('does not spawn npx', () => {
    const source = fs.readFileSync(
      path.join(__dirname, 'prisma-migrate-deploy-exit.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/spawnSync\(\s*['"]npx['"]/);
  });
});

function extractStep(yaml: string, stepId: string): string {
  const match = yaml.match(
    new RegExp(`- id: ${stepId}\\r?\\n([\\s\\S]*?)(?=\\r?\\n  - id: |$)`),
  );
  if (!match) {
    throw new Error(`Cloud Build step '${stepId}' not found`);
  }
  return match[0];
}
