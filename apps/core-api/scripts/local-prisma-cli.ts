import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type LocalPrismaSpawnTarget = {
  command: string;
  shell: boolean;
};

export type PrismaCliSpawnResult = {
  status: number | null;
  output: string;
  error?: Error;
};

export type PrismaCliSpawnInterpretation = {
  exitCode: number;
  spawnErrorMessage?: string;
};

function prismaBinaryName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'prisma.cmd' : 'prisma';
}

function resolvePrismaBinPath(
  fromDirectory: string,
  binaryName: string,
): string {
  const relativeBin = path.join('node_modules', '.bin', binaryName);
  let current = path.resolve(fromDirectory);

  while (true) {
    const candidate = path.join(current, 'node_modules', '.bin', binaryName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return relativeBin;
    }
    current = parent;
  }
}

export function localPrismaSpawnTarget(
  platform: NodeJS.Platform,
  fromDirectory: string = process.cwd(),
): LocalPrismaSpawnTarget {
  return {
    command: resolvePrismaBinPath(fromDirectory, prismaBinaryName(platform)),
    shell: platform === 'win32',
  };
}

export function interpretPrismaCliSpawn(
  result: PrismaCliSpawnResult,
): PrismaCliSpawnInterpretation {
  if (result.error) {
    return {
      exitCode: 1,
      spawnErrorMessage: result.error.message,
    };
  }

  return { exitCode: result.status ?? 1 };
}

export function spawnLocalPrisma(
  args: string[],
  options?: { stdio: 'pipe' | 'inherit' },
): PrismaCliSpawnResult {
  const { command, shell } = localPrismaSpawnTarget(process.platform);
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell,
    stdio: options?.stdio ?? 'pipe',
  });

  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    error: result.error,
  };
}
