import 'dotenv/config';
import { PlatformAdminRole, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { getFirebaseAdminAuth } from '../src/auth/firebase-admin';

type FirebaseUserRecord = {
  uid: string;
  email?: string | null;
  customClaims?: Record<string, unknown>;
};

type SeedPlatformAdminOptions = {
  email: string;
};

type SeedPlatformAdminDependencies = {
  prisma: {
    user: {
      findFirst: (args: {
        where: {
          OR: Array<{
            firebaseUid?: string;
            email?: string;
          }>;
        };
      }) => Promise<{
        id: string;
      } | null>;
      create: (args: {
        data: {
          firebaseUid: string;
          email: string;
        };
      }) => Promise<{
        id: string;
      }>;
      update: (args: {
        where: { id: string };
        data: {
          firebaseUid: string;
          email: string;
        };
      }) => Promise<{
        id: string;
      }>;
    };
    platformAdmin: {
      upsert: (args: {
        where: { user_id: string };
        update: {
          role: PlatformAdminRole;
          is_active: boolean;
        };
        create: {
          user_id: string;
          role: PlatformAdminRole;
          is_active: boolean;
        };
      }) => Promise<{
        id: string;
        role: PlatformAdminRole;
      }>;
    };
    $disconnect?: () => Promise<void>;
  };
  firebaseAuth: {
    getUserByEmail: (email: string) => Promise<FirebaseUserRecord>;
    setCustomUserClaims: (
      uid: string,
      claims: Record<string, unknown>,
    ) => Promise<void>;
  };
};

export function parseSeedPlatformAdminArgs(
  argv: string[],
): SeedPlatformAdminOptions {
  const email = readCliOption(argv, '--email');

  if (!email) {
    throw new Error('Missing required --email=<email> argument.');
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail) {
    throw new Error('Platform admin email must not be empty.');
  }

  return { email: normalizedEmail };
}

export async function seedPlatformAdmin(
  options: SeedPlatformAdminOptions,
  dependencies: SeedPlatformAdminDependencies,
): Promise<{
  email: string;
  firebaseUid: string;
  userId: string;
  platformAdminId: string;
}> {
  const email = options.email.trim().toLowerCase();
  const firebaseUser = await dependencies.firebaseAuth.getUserByEmail(email);
  const resolvedEmail = (firebaseUser.email ?? email).trim().toLowerCase();

  const existingUser = await dependencies.prisma.user.findFirst({
    where: {
      OR: [{ firebaseUid: firebaseUser.uid }, { email: resolvedEmail }],
    },
  });

  const user = existingUser
    ? await dependencies.prisma.user.update({
        where: { id: existingUser.id },
        data: {
          firebaseUid: firebaseUser.uid,
          email: resolvedEmail,
        },
      })
    : await dependencies.prisma.user.create({
        data: {
          firebaseUid: firebaseUser.uid,
          email: resolvedEmail,
        },
      });

  const platformAdmin = await dependencies.prisma.platformAdmin.upsert({
    where: { user_id: user.id },
    update: {
      role: PlatformAdminRole.SUPER_ADMIN,
      is_active: true,
    },
    create: {
      user_id: user.id,
      role: PlatformAdminRole.SUPER_ADMIN,
      is_active: true,
    },
  });

  await dependencies.firebaseAuth.setCustomUserClaims(firebaseUser.uid, {
    ...(firebaseUser.customClaims ?? {}),
    platformRole: PlatformAdminRole.SUPER_ADMIN,
  });

  return {
    email: resolvedEmail,
    firebaseUid: firebaseUser.uid,
    userId: user.id,
    platformAdminId: platformAdmin.id,
  };
}

export async function runSeedPlatformAdminCli(
  argv = process.argv.slice(2),
): Promise<void> {
  const { email } = parseSeedPlatformAdminArgs(argv);
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set.');
  }

  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as never);

  try {
    const result = await seedPlatformAdmin(
      { email },
      {
        prisma,
        firebaseAuth: getFirebaseAdminAuth(),
      },
    );

    console.log(
      `Platform admin seeded for ${result.email} (userId=${result.userId}, firebaseUid=${result.firebaseUid}, platformAdminId=${result.platformAdminId}).`,
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
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
  runSeedPlatformAdminCli()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error(
        error instanceof Error ? error.message : `Unexpected error: ${String(error)}`,
      );
      process.exit(1);
    });
}