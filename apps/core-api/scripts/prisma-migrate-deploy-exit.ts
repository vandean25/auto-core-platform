import {
  interpretPrismaCliSpawn,
  spawnLocalPrisma,
  type PrismaCliSpawnResult,
} from './local-prisma-cli';

export type CloudBuildMigrateExit = {
  exitCode: number;
  message?: string;
};

export const P3005_BASELINE_HINT =
  'Prisma P3005: the database schema is not empty / not baselined. This production deploy must fail. Baseline is a manual one-shot: npm run db:baseline -- --applied <migration_name>.';

export type PrismaMigrateDeployRunner = () => PrismaCliSpawnResult;

export function resolveCloudBuildMigrateExit(
  prismaExitCode: number,
  prismaOutput: string,
): CloudBuildMigrateExit {
  if (prismaExitCode === 0) {
    return { exitCode: 0 };
  }

  if (prismaOutput.includes('P3005')) {
    return {
      exitCode: prismaExitCode,
      message: P3005_BASELINE_HINT,
    };
  }

  return { exitCode: prismaExitCode };
}

export function runPrismaMigrateDeployCli(
  runPrisma: PrismaMigrateDeployRunner,
  writeStdout: (text: string) => void,
  writeStderr: (text: string) => void,
): number {
  const result = runPrisma();
  writeStdout(result.output);
  const spawnOutcome = interpretPrismaCliSpawn(result);
  if (spawnOutcome.spawnErrorMessage) {
    writeStderr(spawnOutcome.spawnErrorMessage);
    return spawnOutcome.exitCode;
  }

  const outcome = resolveCloudBuildMigrateExit(
    spawnOutcome.exitCode,
    result.output,
  );
  if (outcome.message) {
    writeStderr(outcome.message);
  }
  return outcome.exitCode;
}

function spawnPrismaMigrateDeploy(): PrismaCliSpawnResult {
  return spawnLocalPrisma(['migrate', 'deploy']);
}

if (require.main === module) {
  const exitCode = runPrismaMigrateDeployCli(
    spawnPrismaMigrateDeploy,
    (text) => {
      process.stdout.write(text);
    },
    (text) => {
      console.error(text);
    },
  );
  process.exit(exitCode);
}
