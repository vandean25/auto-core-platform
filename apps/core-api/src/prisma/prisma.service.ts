import {
  Inject,
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { DashboardRealtimeService } from '../dashboard-realtime/dashboard-realtime.service.js';
import { createDashboardRealtimeExtension } from './prisma-dashboard-realtime.extension.js';
import { createAuditExtension } from './prisma-audit.extension.js';
import { createTenantIsolationExtension } from './tenant-isolation.extension.js';
import {
  getSharedRuntimePool,
  releaseSharedRuntimePool,
} from './shared-pg-pool.js';
import { DryRunStorage } from '../dry-run/dry-run.storage.js';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;
  public readonly client: PrismaClient;

  constructor(
    @Inject(DashboardRealtimeService)
    dashboardRealtime: DashboardRealtimeService,
  ) {
    const pool = getSharedRuntimePool();
    const adapter = new PrismaPg(pool);

    super({
      adapter,
      log: ['info', 'warn', 'error'],
    });

    this.pool = pool;
    this.client = this.$extends(createTenantIsolationExtension())
      .$extends(createAuditExtension())
      .$extends(
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

        const tx = DryRunStorage.getTransactionClient();
        if (tx) {
          if (property === '$transaction') {
            return (arg: unknown, ...rest: unknown[]): unknown => {
              if (typeof arg === 'function') {
                const callback = arg as (
                  txClient: Prisma.TransactionClient,
                ) => unknown;
                return Promise.resolve().then(() => callback(tx));
              }
              if (Array.isArray(arg)) {
                return Promise.all(arg);
              }
              const txObj = tx as Record<string, unknown>;
              if (typeof txObj.$transaction === 'function') {
                const nestedTx = txObj.$transaction as (
                  ...args: unknown[]
                ) => unknown;
                return nestedTx(arg, ...rest);
              }
              return arg;
            };
          }

          const txObj = tx as Record<string | symbol, unknown>;
          const val: unknown = Reflect.get(txObj, property, txObj);
          if (val !== undefined) {
            if (typeof val === 'function') {
              return (val as (...args: unknown[]) => unknown).bind(
                txObj,
              ) as unknown;
            }
            return val;
          }
        }

        return Reflect.get(target.client, property, target.client) as unknown;
      },
    });

    return serviceProxy;
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

    await this.connectWithRetry();
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
    await releaseSharedRuntimePool();
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
