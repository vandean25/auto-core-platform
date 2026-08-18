import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  interpretPrismaCliSpawn,
  localPrismaSpawnTarget,
} from './local-prisma-cli';

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writePrismaShim(rootDir: string, binaryName: string): string {
  const binDir = path.join(rootDir, 'node_modules', '.bin');
  fs.mkdirSync(binDir, { recursive: true });
  const binaryPath = path.join(binDir, binaryName);
  fs.writeFileSync(binaryPath, '');
  return binaryPath;
}

describe('localPrismaSpawnTarget', () => {
  it('uses a shell on Windows', () => {
    expect(localPrismaSpawnTarget('win32', makeTempDir('prisma-win-')).shell).toBe(
      true,
    );
  });

  it('does not use a shell on POSIX', () => {
    expect(localPrismaSpawnTarget('linux', makeTempDir('prisma-posix-')).shell).toBe(
      false,
    );
  });

  it('uses a cwd-relative prisma shim when it exists', () => {
    const packageDir = makeTempDir('prisma-local-');
    const binaryPath = writePrismaShim(packageDir, 'prisma');

    expect(localPrismaSpawnTarget('linux', packageDir).command).toBe(binaryPath);
  });

  it('walks up from a workspace package to a hoisted prisma shim', () => {
    const repoRoot = makeTempDir('prisma-hoist-');
    const workspaceDir = path.join(repoRoot, 'apps', 'core-api');
    fs.mkdirSync(workspaceDir, { recursive: true });
    const binaryPath = writePrismaShim(repoRoot, 'prisma');

    expect(localPrismaSpawnTarget('linux', workspaceDir).command).toBe(
      binaryPath,
    );
  });

  it('walks up to a hoisted prisma.cmd on Windows', () => {
    const repoRoot = makeTempDir('prisma-hoist-win-');
    const workspaceDir = path.join(repoRoot, 'apps', 'core-api');
    fs.mkdirSync(workspaceDir, { recursive: true });
    const binaryPath = writePrismaShim(repoRoot, 'prisma.cmd');

    expect(localPrismaSpawnTarget('win32', workspaceDir).command).toBe(
      binaryPath,
    );
  });

  it('falls back to a cwd-relative shim when no ancestor has prisma', () => {
    const emptyDir = makeTempDir('prisma-missing-');

    expect(localPrismaSpawnTarget('linux', emptyDir).command).toBe(
      path.join('node_modules', '.bin', 'prisma'),
    );
  });
});

describe('interpretPrismaCliSpawn', () => {
  it('returns prisma status when the process starts', () => {
    expect(
      interpretPrismaCliSpawn({ status: 0, output: 'applied\n' }),
    ).toEqual({ exitCode: 0 });
  });

  it('surfaces spawn errors as a hard failure', () => {
    expect(
      interpretPrismaCliSpawn({
        status: null,
        output: '',
        error: new Error('spawn prisma.cmd ENOENT'),
      }),
    ).toEqual({
      exitCode: 1,
      spawnErrorMessage: 'spawn prisma.cmd ENOENT',
    });
  });

  it('fails closed when spawn sets an error even if status is 0', () => {
    expect(
      interpretPrismaCliSpawn({
        status: 0,
        output: '',
        error: new Error('spawn prisma ENOENT'),
      }).exitCode,
    ).toBe(1);
  });
});
