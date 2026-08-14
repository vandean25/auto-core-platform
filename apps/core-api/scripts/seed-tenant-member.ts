import 'dotenv/config';
import { PlatformAdminRole, PrismaClient, TenantMemberRole } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { getFirebaseAdminAuth } from '../src/auth/firebase-admin';

type FirebaseUserRecord = {
  uid: string;
  email?: string | null;
  customClaims?: Record<string, unknown>;
};

type SeedTenantMemberOptions = {
  email: string;
  tenantSlug: string;
  role: TenantMemberRole;
  makeActive: boolean;
};

type SeedTenantMemberResult = {
  email: string;
  tenantSlug: string;
  tenantId: string;
  userId: string;
  firebaseUid: string;
  membershipId: string;
  role: TenantMemberRole;
  activeTenantId: string | null;
};

type UserAccessProjection = {
  id: string;
  firebaseUid: string;
  email: string;
  active_tenant_id: string | null;
  platformAdmin: {
    role: PlatformAdminRole;
    is_active: boolean;
  } | null;
  memberships: Array<{
    tenant_id: string;
    role: TenantMemberRole;
    is_active: boolean;
    tenant: { is_active: boolean };
  }>;
};

type SeedTenantMemberDependencies = {
  prisma: {
    tenant: {
      findFirst: (args: { where: { slug: string } }) => Promise<{
        id: string;
        slug: string;
        is_active: boolean;
      } | null>;
    };
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
        active_tenant_id: string | null;
      } | null>;
      create: (args: {
        data: {
          firebaseUid: string;
          email: string;
          active_tenant_id?: string;
        };
      }) => Promise<{
        id: string;
        active_tenant_id: string | null;
      }>;
      update: (args: {
        where: { id: string };
        data: {
          firebaseUid?: string;
          email?: string;
          active_tenant_id?: string;
        };
      }) => Promise<{
        id: string;
        active_tenant_id: string | null;
      }>;
    };
    tenantMember: {
      upsert: (args: {
        where: {
          tenant_id_user_id: {
            tenant_id: string;
            user_id: string;
          };
        };
        update: {
          role: TenantMemberRole;
          is_active: boolean;
        };
        create: {
          tenant_id: string;
          user_id: string;
          role: TenantMemberRole;
          is_active: boolean;
        };
      }) => Promise<{
        id: string;
        tenant_id: string;
        user_id: string;
        role: TenantMemberRole;
        is_active: boolean;
      }>;
    };
    userAccessProjection: (userId: string) => Promise<UserAccessProjection | null>;
    $disconnect?: () => Promise<void>;
  };
  firebaseAuth: {
    getUserByEmail: (email: string) => Promise<FirebaseUserRecord>;
    createUser: (data: { email: string }) => Promise<FirebaseUserRecord>;
    getUser: (uid: string) => Promise<FirebaseUserRecord>;
    setCustomUserClaims: (
      uid: string,
      claims: Record<string, unknown>,
    ) => Promise<void>;
  };
};

const TENANT_MEMBER_ROLES = ['OWNER', 'ADMIN', 'TECH', 'SALES'] as const;

export function parseSeedTenantMemberArgs(
  argv: string[],
): SeedTenantMemberOptions {
  const email = readCliOption(argv, '--email');
  const tenantSlug = readCliOption(argv, '--tenant-slug');
  const roleInput = readCliOption(argv, '--role') ?? 'ADMIN';
  const makeActive = hasFlag(argv, '--make-active');

  if (!email) {
    throw new Error('Missing required --email=<email> argument.');
  }

  if (!tenantSlug) {
    throw new Error('Missing required --tenant-slug=<slug> argument.');
  }

  const normalizedEmail = email.trim().toLowerCase();
  const normalizedTenantSlug = tenantSlug.trim().toLowerCase();
  const normalizedRole = roleInput.trim().toUpperCase();

  if (!normalizedEmail) {
    throw new Error('Tenant member email must not be empty.');
  }

  if (!normalizedTenantSlug) {
    throw new Error('Tenant slug must not be empty.');
  }

  if (!TENANT_MEMBER_ROLES.includes(normalizedRole as TenantMemberRole)) {
    throw new Error(
      `Invalid --role value "${roleInput}". Allowed: ${TENANT_MEMBER_ROLES.join(', ')}.`,
    );
  }

  return {
    email: normalizedEmail,
    tenantSlug: normalizedTenantSlug,
    role: normalizedRole as TenantMemberRole,
    makeActive,
  };
}

export async function seedTenantMember(
  options: SeedTenantMemberOptions,
  dependencies: SeedTenantMemberDependencies,
): Promise<SeedTenantMemberResult> {
  const tenant = await dependencies.prisma.tenant.findFirst({
    where: { slug: options.tenantSlug },
  });

  if (!tenant) {
    throw new Error(`Tenant with slug "${options.tenantSlug}" was not found.`);
  }

  const firebaseUser = await resolveFirebaseUser(
    options.email,
    dependencies.firebaseAuth,
  );
  const resolvedEmail = (firebaseUser.email ?? options.email).trim().toLowerCase();

  const existingUser = await dependencies.prisma.user.findFirst({
    where: {
      OR: [{ firebaseUid: firebaseUser.uid }, { email: resolvedEmail }],
    },
  });

  const activeTenantId = options.makeActive
    ? tenant.id
    : existingUser?.active_tenant_id ?? tenant.id;

  const user = existingUser
    ? await dependencies.prisma.user.update({
        where: { id: existingUser.id },
        data: {
          firebaseUid: firebaseUser.uid,
          email: resolvedEmail,
          ...(options.makeActive ? { active_tenant_id: tenant.id } : {}),
        },
      })
    : await dependencies.prisma.user.create({
        data: {
          firebaseUid: firebaseUser.uid,
          email: resolvedEmail,
          active_tenant_id: activeTenantId,
        },
      });

  const membership = await dependencies.prisma.tenantMember.upsert({
    where: {
      tenant_id_user_id: {
        tenant_id: tenant.id,
        user_id: user.id,
      },
    },
    update: {
      role: options.role,
      is_active: true,
    },
    create: {
      tenant_id: tenant.id,
      user_id: user.id,
      role: options.role,
      is_active: true,
    },
  });

  await syncUserClaims(user.id, dependencies);

  const refreshedUser = await dependencies.prisma.userAccessProjection(user.id);
  const nextActiveTenantId = refreshedUser?.active_tenant_id ?? null;

  return {
    email: resolvedEmail,
    tenantSlug: tenant.slug,
    tenantId: tenant.id,
    userId: user.id,
    firebaseUid: firebaseUser.uid,
    membershipId: membership.id,
    role: membership.role,
    activeTenantId: nextActiveTenantId,
  };
}

export async function runSeedTenantMemberCli(
  argv = process.argv.slice(2),
): Promise<void> {
  const options = parseSeedTenantMemberArgs(argv);
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set.');
  }

  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as never);

  const dependencies: SeedTenantMemberDependencies = {
    prisma: {
      tenant: prisma.tenant as never,
      user: prisma.user as never,
      tenantMember: prisma.tenantMember as never,
      userAccessProjection: (userId: string) =>
        prisma.user.findFirst({
          where: { id: userId },
          include: {
            platformAdmin: true,
            memberships: {
              where: {
                is_active: true,
                tenant: { is_active: true },
              },
              orderBy: [{ createdAt: 'asc' }],
              include: {
                tenant: {
                  select: { is_active: true },
                },
              },
            },
          },
        }) as never,
      $disconnect: () => prisma.$disconnect(),
    },
    firebaseAuth: getFirebaseAdminAuth(),
  };

  try {
    const result = await seedTenantMember(options, dependencies);

    console.log(
      `Tenant member seeded for ${result.email} (tenant=${result.tenantSlug}, role=${result.role}, userId=${result.userId}, membershipId=${result.membershipId}, activeTenantId=${result.activeTenantId ?? 'null'}).`,
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

async function resolveFirebaseUser(
  email: string,
  firebaseAuth: SeedTenantMemberDependencies['firebaseAuth'],
): Promise<FirebaseUserRecord> {
  try {
    return await firebaseAuth.getUserByEmail(email);
  } catch (error) {
    if (getFirebaseErrorCode(error) === 'auth/user-not-found') {
      return firebaseAuth.createUser({ email });
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to resolve Firebase user for ${email}: ${message}`);
  }
}

async function syncUserClaims(
  userId: string,
  dependencies: SeedTenantMemberDependencies,
): Promise<void> {
  const user = await dependencies.prisma.userAccessProjection(userId);

  if (!user) {
    throw new Error(`Unable to project claims for user ${userId}.`);
  }

  const activeMembership =
    user.memberships.find(
      (membership) => membership.tenant_id === user.active_tenant_id,
    ) ?? user.memberships[0] ?? null;

  if ((user.active_tenant_id ?? null) !== (activeMembership?.tenant_id ?? null)) {
    await dependencies.prisma.user.update({
      where: { id: user.id },
      data: { active_tenant_id: activeMembership?.tenant_id },
    });
  }

  const firebaseUser = await dependencies.firebaseAuth.getUser(user.firebaseUid);
  const nextClaims = {
    ...(firebaseUser.customClaims ?? {}),
  } as Record<string, unknown>;

  delete nextClaims.tenantId;
  delete nextClaims.role;
  delete nextClaims.platformRole;

  if (activeMembership) {
    nextClaims.tenantId = activeMembership.tenant_id;
    nextClaims.role = activeMembership.role;
  }

  if (user.platformAdmin?.is_active) {
    nextClaims.platformRole = user.platformAdmin.role;
  }

  await dependencies.firebaseAuth.setCustomUserClaims(user.firebaseUid, nextClaims);
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

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function getFirebaseErrorCode(error: unknown): string | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code;
  }

  return undefined;
}

if (require.main === module) {
  runSeedTenantMemberCli()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error(
        error instanceof Error ? error.message : `Unexpected error: ${String(error)}`,
      );
      process.exit(1);
    });
}
