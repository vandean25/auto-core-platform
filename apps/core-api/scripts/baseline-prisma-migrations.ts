import { spawnSync } from 'node:child_process';

export type BaselinePrismaOptions = {
  appliedMigration: string;
};

export function parseBaselinePrismaArgs(argv: string[]): BaselinePrismaOptions {
  const appliedMigration = readCliOption(argv, '--applied');

  if (!appliedMigration) {
    throw new Error(
      'Missing required --applied=<migration_name> argument. This one-shot baseline is not part of tag-triggered Cloud Build.',
    );
  }

  return { appliedMigration };
}

export function prismaBaselineResolveArgs(appliedMigration: string): string[] {
  return ['prisma', 'migrate', 'resolve', '--applied', appliedMigration];
}

function runBaselinePrismaMigrationsCli(): void {
  const { appliedMigration } = parseBaselinePrismaArgs(process.argv.slice(2));
  const args = prismaBaselineResolveArgs(appliedMigration);

  console.error(
    'Running a manual one-shot Prisma baseline. Do not invoke this from the tag-triggered Cloud Build migrate-db step.',
  );

  const result = spawnSync('npx', args, { encoding: 'utf8', stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

function readCliOption(argv: string[], flag: string): string | undefined {
  const inlineArg = argv.find((arg) => arg.startsWith(`${flag}=`));
  if (inlineArg) {
    return inlineArg.slice(flag.length + 1);
  }

  const flagIndex = argv.indexOf(flag);
  if (flagIndex >= 0) {
    return argv[flagIndex + 1];
  }

  return undefined;
}

if (require.main === module) {
  try {
    runBaselinePrismaMigrationsCli();
  } catch (error: unknown) {
    console.error(
      error instanceof Error ? error.message : `Unexpected error: ${String(error)}`,
    );
    process.exit(1);
  }
}
