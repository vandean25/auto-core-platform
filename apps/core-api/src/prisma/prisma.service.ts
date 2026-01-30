import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);

    super({
      adapter,
      log: ['info', 'warn', 'error'],
    } as any);

    this.pool = pool;
  }

  async onModuleInit() {
    // Retry logic is less relevant for the *constructor* adapter setup,
    // but we can still try-catch the first query or keep the logic if connect() is called.
    // With adapter, $connect is implicit usually, but explicit call verifies connection.
    await this.connectWithRetry();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }

  private async connectWithRetry(retries = 5, delay = 2000) {
    for (let i = 0; i < retries; i++) {
      try {
        await this.$connect();
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
