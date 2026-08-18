import { spawnSync } from 'node:child_process';
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

export function localPrismaSpawnTarget(
  platform: NodeJS.Platform,
): LocalPrismaSpawnTarget {
  if (platform === 'win32') {
    return {
      command: path.join('node_modules', '.bin', 'prisma.cmd'),
      shell: true,
    };
  }

  return {
    command: path.join('node_modules', '.bin', 'prisma'),
    shell: false,
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
