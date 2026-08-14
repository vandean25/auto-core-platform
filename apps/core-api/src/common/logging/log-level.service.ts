import { Injectable, Logger, type LogLevel } from '@nestjs/common';

export type AppLogLevel = 'error' | 'warn' | 'log' | 'debug' | 'verbose';

export const VALID_LOG_LEVELS: readonly AppLogLevel[] = [
  'error',
  'warn',
  'log',
  'debug',
  'verbose',
] as const;

export interface LogLevelOverride {
  level: AppLogLevel;
  expiresAt?: Date;
  updatedBy?: string;
  updatedAt: Date;
}

export interface SetLogLevelOptions {
  level: AppLogLevel;
  durationMinutes?: number;
  actorId?: string;
}

export interface LogLevelStatus {
  currentLevel: AppLogLevel;
  defaultLevel: AppLogLevel;
  override?: {
    level: AppLogLevel;
    expiresAt?: string;
    updatedBy?: string;
    updatedAt: string;
  };
}

@Injectable()
export class LogLevelService {
  private readonly logger = new Logger(LogLevelService.name);
  private readonly defaultLevel: AppLogLevel;
  private activeOverride: LogLevelOverride | null = null;

  constructor() {
    this.defaultLevel = LogLevelService.parseLogLevel(process.env.LOG_LEVEL);
  }

  static parseLogLevel(raw?: string): AppLogLevel {
    if (!raw || typeof raw !== 'string') {
      return 'log';
    }

    const normalized = raw.trim().toLowerCase();
    if (VALID_LOG_LEVELS.includes(normalized as AppLogLevel)) {
      return normalized as AppLogLevel;
    }

    return 'log';
  }

  static getNestLogLevels(level: AppLogLevel): LogLevel[] {
    switch (level) {
      case 'error':
        return ['error', 'fatal'];
      case 'warn':
        return ['error', 'warn', 'fatal'];
      case 'log':
        return ['error', 'warn', 'log', 'fatal'];
      case 'debug':
        return ['error', 'warn', 'log', 'debug', 'fatal'];
      case 'verbose':
        return ['error', 'warn', 'log', 'debug', 'verbose', 'fatal'];
      default:
        return ['error', 'warn', 'log', 'fatal'];
    }
  }

  static getInitialNestLogLevels(): LogLevel[] {
    return this.getNestLogLevels(this.parseLogLevel(process.env.LOG_LEVEL));
  }

  getDefaultLevel(): AppLogLevel {
    return this.defaultLevel;
  }

  getEffectiveLevel(): AppLogLevel {
    this.cleanupExpiredOverride();
    return this.activeOverride ? this.activeOverride.level : this.defaultLevel;
  }

  getStatus(): LogLevelStatus {
    this.cleanupExpiredOverride();
    const effective = this.getEffectiveLevel();

    return {
      currentLevel: effective,
      defaultLevel: this.defaultLevel,
      ...(this.activeOverride
        ? {
            override: {
              level: this.activeOverride.level,
              ...(this.activeOverride.expiresAt
                ? { expiresAt: this.activeOverride.expiresAt.toISOString() }
                : {}),
              ...(this.activeOverride.updatedBy
                ? { updatedBy: this.activeOverride.updatedBy }
                : {}),
              updatedAt: this.activeOverride.updatedAt.toISOString(),
            },
          }
        : {}),
    };
  }

  setLogLevel(options: SetLogLevelOptions): {
    currentLevel: AppLogLevel;
    defaultLevel: AppLogLevel;
    expiresAt?: string;
    updatedBy?: string;
    updatedAt: string;
  } {
    const previousLevel = this.getEffectiveLevel();
    const now = new Date();

    let duration = options.durationMinutes;
    if (
      (options.level === 'debug' || options.level === 'verbose') &&
      (!duration || duration <= 0)
    ) {
      // Default to 30 minutes for debug and verbose if unspecified
      duration = 30;
    }

    const expiresAt =
      duration && duration > 0
        ? new Date(now.getTime() + duration * 60 * 1000)
        : undefined;

    this.activeOverride = {
      level: options.level,
      expiresAt,
      updatedBy: options.actorId,
      updatedAt: now,
    };

    // Apply to NestJS logger
    Logger.overrideLogger(LogLevelService.getNestLogLevels(options.level));

    this.logger.log(
      JSON.stringify({
        type: 'log_level_changed',
        previousLevel,
        newLevel: options.level,
        ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
        ...(options.actorId ? { actorId: options.actorId } : {}),
      }),
    );

    return {
      currentLevel: options.level,
      defaultLevel: this.defaultLevel,
      ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
      ...(options.actorId ? { updatedBy: options.actorId } : {}),
      updatedAt: now.toISOString(),
    };
  }

  resetLogLevel(actorId?: string): void {
    const previousLevel = this.getEffectiveLevel();
    this.activeOverride = null;

    Logger.overrideLogger(LogLevelService.getNestLogLevels(this.defaultLevel));

    this.logger.log(
      JSON.stringify({
        type: 'log_level_reset',
        previousLevel,
        restoredDefaultLevel: this.defaultLevel,
        ...(actorId ? { actorId } : {}),
      }),
    );
  }

  private cleanupExpiredOverride(): void {
    if (!this.activeOverride) {
      return;
    }

    if (
      this.activeOverride.expiresAt &&
      Date.now() > this.activeOverride.expiresAt.getTime()
    ) {
      const expiredLevel = this.activeOverride.level;
      this.activeOverride = null;

      Logger.overrideLogger(LogLevelService.getNestLogLevels(this.defaultLevel));

      this.logger.log(
        JSON.stringify({
          type: 'log_level_override_expired',
          expiredLevel,
          revertedToDefaultLevel: this.defaultLevel,
        }),
      );
    }
  }
}
