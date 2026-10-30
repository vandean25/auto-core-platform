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
  createVehicleMediaPurgeExtension,
  createVehicleMediaPurgeTransactionExtension,
} from '../vehicle-stock/vehicle-media/vehicle-media-purge.extension.js';
import {
  getSharedRuntimePool,
  releaseSharedRuntimePool,
} from './shared-pg-pool.js';
import { DryRunStorage } from '../dry-run/dry-run.storage.js';
import { PrismaTransactionContext } from './prisma-transaction-context.js';

type PrismaTransactionCall = (first: unknown, ...args: unknown[]) => unknown;
type PrismaTransactionCallback = (
  txClient: Prisma.TransactionClient,
) => unknown;

const MISSING = Symbol('missing');

const SERVICE_PROPERTIES = new Set<PropertyKey>([
  'client',
  'logger',
  'pool',
  'onModuleInit',
  'onModuleDestroy',
  'connectWithRetry',
]);

/** Runs interactive transaction callbacks with their client on the audit snapshot context. */
function createTransactionRunner(client: PrismaClient): PrismaTransactionCall {
  const runTransaction = (
    Reflect.get(client, '$transaction', client) as PrismaTransactionCall
  ).bind(client);

  return (first, ...rest) => {
    if (typeof first !== 'function') {
      return runTransaction(first, ...rest);
    }
    const callback = first as PrismaTransactionCallback;
    return runTransaction(
      async (txClient: Prisma.TransactionClient) =>
        await PrismaTransactionContext.run(
          txClient,
          async () => await callback(txClient),
        ),
      ...rest,
    );
  };
}

/** Inside a dry-run rollback transaction every read and write stays on that client. */
function createDryRunTransactionCall(
  tx: Prisma.TransactionClient,
): PrismaTransactionCall {
  return (first, ...rest) => {
    if (typeof first === 'function') {
      const callback = first as PrismaTransactionCallback;
      return Promise.resolve().then(() => callback(tx));
    }
    if (Array.isArray(first)) {
      return Promise.all(first);
    }
    const txObj = tx as Record<string, unknown>;
    if (typeof txObj.$transaction === 'function') {
      return (txObj.$transaction as PrismaTransactionCall)(first, ...rest);
    }
    return first;
  };
}

function bindTransactionProperty(
  txObj: Record<PropertyKey, unknown>,
  value: unknown,
): unknown {
  return typeof value === 'function'
    ? (value as (...args: unknown[]) => unknown).bind(txObj)
    : value;
}

/** Returns MISSING when the dry-run client has no such property, so the outer client applies. */
function getDryRunProperty(
  tx: Prisma.TransactionClient,
  property: PropertyKey,
): unknown {
  if (property === '$transaction') {
    return createDryRunTransactionCall(tx);
  }
  const txObj = tx as Record<PropertyKey, unknown>;
  const value = Reflect.get(txObj, property, txObj);
  return value === undefined ? MISSING : bindTransactionProperty(txObj, value);
}

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
      .$extends(createVehicleMediaPurgeExtension())
      .$extends(createAuditExtension())
      .$extends(createDashboardRealtimeExtension(dashboardRealtime))
      .$extends(
        createVehicleMediaPurgeTransactionExtension(),
      ) as unknown as PrismaClient;

    const serviceProxy = new Proxy(this, {
      get(target, property, receiver) {
        if (SERVICE_PROPERTIES.has(property)) {
          return Reflect.get(target, property, receiver);
        }

        const tx = DryRunStorage.getTransactionClient();
        if (tx) {
          const fromTransaction = getDryRunProperty(tx, property);
          if (fromTransaction !== MISSING) {
            return fromTransaction;
          }
        }

        if (property === '$transaction') {
          return createTransactionRunner(target.client);
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
