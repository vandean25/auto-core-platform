import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  DynamicModule,
  Module,
  Global,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const THROTTLER_LIMIT = 'THROTTLER:LIMIT';
export const THROTTLER_TTL = 'THROTTLER:TTL';
export const THROTTLER_TRACKER = 'THROTTLER:TRACKER';
export const THROTTLER_BLOCK_DURATION = 'THROTTLER:BLOCK_DURATION';
export const THROTTLER_KEY_GENERATOR = 'THROTTLER:KEY_GENERATOR';
export const THROTTLER_OPTIONS = 'THROTTLER:MODULE_OPTIONS';
export const THROTTLER_SKIP = 'THROTTLER:SKIP';

export const throttlerMessage = 'ThrottlerException: Too Many Requests';

export class ThrottlerException extends HttpException {
  constructor(message?: string) {
    super(message || throttlerMessage, HttpStatus.TOO_MANY_REQUESTS);
  }
}

export function Throttle(
  options: Record<string, { limit?: number; ttl?: number }>,
) {
  return (
    target: unknown,
    propertyKey?: string,
    descriptor?: PropertyDescriptor,
  ) => {
    const tgt = descriptor ? descriptor.value : target;
    for (const name in options) {
      Reflect.defineMetadata(THROTTLER_TTL + name, options[name].ttl, tgt);
      Reflect.defineMetadata(THROTTLER_LIMIT + name, options[name].limit, tgt);
    }
    return descriptor ?? target;
  };
}

export function SkipThrottle(
  skip: Record<string, boolean> = { default: true },
) {
  return (
    target: unknown,
    propertyKey?: string,
    descriptor?: PropertyDescriptor,
  ) => {
    const tgt = descriptor ? descriptor.value : target;
    for (const key in skip) {
      Reflect.defineMetadata(THROTTLER_SKIP + key, skip[key], tgt);
    }
    return descriptor ?? target;
  };
}

export interface ThrottlerOptions {
  name?: string;
  limit: number;
  ttl: number;
  blockDuration?: number;
  skipIf?: (context: ExecutionContext) => boolean;
}

interface HitRecord {
  hits: number;
  expiresAt: number;
}

@Injectable()
export class ThrottlerStorageService {
  private records = new Map<string, HitRecord>();

  async increment(key: string, ttl: number, limit: number) {
    const now = Date.now();
    let record = this.records.get(key);
    if (!record || record.expiresAt <= now) {
      record = { hits: 1, expiresAt: now + ttl };
      this.records.set(key, record);
    } else {
      record.hits += 1;
    }
    const isBlocked = record.hits > limit;
    return {
      totalHits: record.hits,
      timeToExpire: Math.max(0, Math.ceil((record.expiresAt - now) / 1000)),
      isBlocked,
      timeToBlockExpire: Math.max(0, Math.ceil((record.expiresAt - now) / 1000)),
    };
  }
}

@Injectable()
export class ThrottlerGuard implements CanActivate {
  private throttlers: ThrottlerOptions[];

  constructor(
    @Inject(THROTTLER_OPTIONS)
    private options: ThrottlerOptions[] | { throttlers: ThrottlerOptions[] },
    private storageService: ThrottlerStorageService,
    private reflector: Reflector,
  ) {
    const list = Array.isArray(this.options)
      ? this.options
      : this.options?.throttlers || [];
    this.throttlers = list.map((opt) => ({
      ...opt,
      name: opt.name ?? 'default',
    }));
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const classRef = context.getClass();
    const req = context.switchToHttp().getRequest();

    for (const throttler of this.throttlers) {
      if (throttler.skipIf && throttler.skipIf(context)) {
        continue;
      }

      const skip = this.reflector.getAllAndOverride<boolean>(
        THROTTLER_SKIP + throttler.name,
        [handler, classRef],
      );
      if (skip) {
        continue;
      }

      const limit =
        this.reflector.getAllAndOverride<number>(
          THROTTLER_LIMIT + throttler.name,
          [handler, classRef],
        ) ?? throttler.limit;
      const ttl =
        this.reflector.getAllAndOverride<number>(
          THROTTLER_TTL + throttler.name,
          [handler, classRef],
        ) ?? throttler.ttl;

      const tracker =
        req?.ip || req?.headers?.['x-forwarded-for'] || '127.0.0.1';
      const key = `${throttler.name}:${tracker}:${req?.route?.path || req?.originalUrl || req?.url || ''}`;

      const { isBlocked } = await this.storageService.increment(
        key,
        ttl,
        limit,
      );
      if (isBlocked) {
        throw new ThrottlerException();
      }
    }
    return true;
  }
}

@Global()
@Module({})
export class ThrottlerModule {
  static forRoot(
    options: ThrottlerOptions[] | { throttlers: ThrottlerOptions[] } = [],
  ): DynamicModule {
    const providers = [
      { provide: THROTTLER_OPTIONS, useValue: options },
      ThrottlerStorageService,
      ThrottlerGuard,
    ];
    return {
      module: ThrottlerModule,
      providers,
      exports: providers,
    };
  }
}
