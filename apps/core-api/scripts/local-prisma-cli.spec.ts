import * as path from 'node:path';
import {
  interpretPrismaCliSpawn,
  localPrismaSpawnTarget,
} from './local-prisma-cli';

describe('localPrismaSpawnTarget', () => {
  it('uses prisma.cmd with a shell on Windows', () => {
    expect(localPrismaSpawnTarget('win32')).toEqual({
      command: path.join('node_modules', '.bin', 'prisma.cmd'),
      shell: true,
    });
  });

  it('uses the prisma shim without a shell on POSIX', () => {
    expect(localPrismaSpawnTarget('linux')).toEqual({
      command: path.join('node_modules', '.bin', 'prisma'),
      shell: false,
    });
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
