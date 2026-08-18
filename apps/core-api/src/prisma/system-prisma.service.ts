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

@Injectable()
export class SystemPrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SystemPrismaService.name);
  private readonly pool: Pool;

  constructor() {
    const pool = getSharedRuntimePool();
    const adapter = new PrismaPg(pool);

    super({
      adapter,
      log: ['info', 'warn', 'error'],
    });

    this.pool = pool;
  }

  get client(): PrismaClient {
    return this;
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
    await this.$disconnect();
    await releaseSharedRuntimePool();
  }

  private async connectWithRetry(retries = 5, delay = 2000) {
    for (let attempt = 0; attempt < retries; attempt += 1) {
      try {
        await this.$connect();
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
