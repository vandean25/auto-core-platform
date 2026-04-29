import {
  Inject,
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
  forwardRef,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { DashboardRealtimeService } from '../dashboard-realtime/dashboard-realtime.service';
import { createDashboardRealtimeExtension } from './prisma-dashboard-realtime.extension';
import { createTenantIsolationExtension } from './tenant-isolation.extension';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private pool: Pool;
  public readonly client: PrismaClient;

  constructor(
    @Inject(forwardRef(() => DashboardRealtimeService))
    dashboardRealtime: DashboardRealtimeService,
  ) {
    const connectionString = process.env.DATABASE_URL;
    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);

    super({
      adapter,
      log: ['info', 'warn', 'error'],
    });

    this.pool = pool;
    this.client = this.$extends(createTenantIsolationExtension()).$extends(
      createDashboardRealtimeExtension(dashboardRealtime),
    ) as PrismaClient;

    const serviceProxy = new Proxy(this, {
      get(target, property, receiver) {
        if (
          property === 'client' ||
          property === 'logger' ||
          property === 'pool' ||
          property === 'onModuleInit' ||
          property === 'onModuleDestroy' ||
          property === 'connectWithRetry'
        ) {
          return Reflect.get(target, property, receiver);
        }

        return Reflect.get(target.client as object, property, target.client);
      },
    });

    return serviceProxy as PrismaService;
  }

  async onModuleInit() {
    if (
      process.env.SKIP_PRISMA_CONNECT === 'true' ||
      process.env.SKIP_PRISMA_CONNECT === '1'
    ) {
      this.logger.warn(
        'Skipping Prisma database connection (SKIP_PRISMA_CONNECT set).',
      );
      return;
    }

    // Retry logic is less relevant for the *constructor* adapter setup,
    // but we can still try-catch the first query or keep the logic if connect() is called.
    // With adapter, $connect is implicit usually, but explicit call verifies connection.
    await this.connectWithRetry();
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
    await this.pool.end();
  }

  private async connectWithRetry(retries = 5, delay = 2000) {
    for (let i = 0; i < retries; i++) {
      try {
        await this.client.$connect();
        this.logger.log('Successfully connected to the database via Adapter.');
        return;
      } catch (error) {
        this.logger.error(
          `Failed to connect to database (Attempt ${i + 1}/${retries}). Retrying in ${delay / 1000}s...`,
          error,
        );
        if (i === retries - 1) {
          this.logger.error('All connection attempts failed. Exiting...');
          throw error;
        }
        await new Promise((res) => setTimeout(res, delay));
      }
    }
  }
}
