import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import {
  getSharedRuntimePool,
  releaseSharedRuntimePool,
} from './shared-pg-pool';
import {
  createSystemPrismaTransactionClient,
  type AssertSystemPrismaOmitsTenantModels,
  type SystemPrismaClient,
  type SystemPrismaTransactionClient,
} from './system-prisma.types';

/**
 * Unextended Prisma client for global identity and three documented exceptions.
 *
 * Allowed callers:
 * - AuthSessionService — User
 * - TenantMemberService — User, TenantMember
 * - PlatformAdminService — Tenant, FinanceSettings (new-tenant bootstrap only)
 * - MechanicSchedulerService — LaborEntry (nightly cross-tenant close only)
 * - HrAttendanceSchedulerService — AttendanceEvent (nightly close only)
 *
 * Tenant-scoped models (Customer, Vehicle, WorkshopOrder, …) are omitted from
 * the type and undefined at runtime. Use PrismaService so isolation applies.
 * See docs/internal/05-Runbooks/system-prisma-allowlist.md.
 */
@Injectable()
export class SystemPrismaService
  implements OnModuleInit, OnModuleDestroy, SystemPrismaClient
{
  private readonly logger = new Logger(SystemPrismaService.name);
  private readonly pool: Pool;
  private readonly prisma: PrismaClient;

  constructor() {
    const pool = getSharedRuntimePool();
    const adapter = new PrismaPg(pool);

    this.prisma = new PrismaClient({
      adapter,
      log: ['info', 'warn', 'error'],
    });

    this.pool = pool;
  }

  get tenant(): PrismaClient['tenant'] {
    return this.prisma.tenant;
  }

  get user(): PrismaClient['user'] {
    return this.prisma.user;
  }

  get tenantMember(): PrismaClient['tenantMember'] {
    return this.prisma.tenantMember;
  }

  get platformAdmin(): PrismaClient['platformAdmin'] {
    return this.prisma.platformAdmin;
  }

  get laborEntry(): PrismaClient['laborEntry'] {
    return this.prisma.laborEntry;
  }

  get financeSettings(): PrismaClient['financeSettings'] {
    return this.prisma.financeSettings;
  }

  get attendanceEvent(): PrismaClient['attendanceEvent'] {
    return this.prisma.attendanceEvent;
  }

  $transaction<Result>(
    fn: (transaction: SystemPrismaTransactionClient) => Promise<Result>,
    options?: Parameters<SystemPrismaClient['$transaction']>[1],
  ): Promise<Result> {
    return this.prisma.$transaction((transaction) => {
      return fn(createSystemPrismaTransactionClient(transaction));
    }, options);
  }

  async onModuleInit() {
    if (
      process.env.SKIP_PRISMA_CONNECT === 'true' ||
      process.env.SKIP_PRISMA_CONNECT === '1'
    ) {
      this.logger.warn(
        'Skipping system Prisma database connection (SKIP_PRISMA_CONNECT set).',
      );
      return;
    }

    await this.connectWithRetry();
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
    await releaseSharedRuntimePool();
  }

  private async connectWithRetry(retries = 5, delay = 2000) {
    for (let attempt = 0; attempt < retries; attempt += 1) {
      try {
        await this.prisma.$connect();
        this.logger.log('Successfully connected to the database via Adapter.');
        return;
      } catch (error) {
        this.logger.error(
          `Failed to connect to database (Attempt ${attempt + 1}/${retries}). Retrying in ${delay / 1000}s...`,
          error,
        );

        if (attempt === retries - 1) {
          this.logger.error('All connection attempts failed. Exiting...');
          throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
}

export const SYSTEM_PRISMA_OMITS_TENANT_MODELS =
  true satisfies AssertSystemPrismaOmitsTenantModels<SystemPrismaService>;
