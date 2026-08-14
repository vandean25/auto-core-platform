import { LogLevelService, type AppLogLevel } from './log-level.service';

describe('LogLevelService', () => {
  let service: LogLevelService;

  beforeEach(() => {
    delete process.env.LOG_LEVEL;
    service = new LogLevelService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe('boot-time resolution and defaults', () => {
    it('defaults to "log" when LOG_LEVEL is not set', () => {
      expect(service.getDefaultLevel()).toBe('log');
      expect(service.getEffectiveLevel()).toBe('log');
    });

    it('parses valid boot-time LOG_LEVEL environment variable', () => {
      process.env.LOG_LEVEL = 'warn';
      const warnService = new LogLevelService();
      expect(warnService.getDefaultLevel()).toBe('warn');
      expect(warnService.getEffectiveLevel()).toBe('warn');

      process.env.LOG_LEVEL = 'ERROR';
      const errorService = new LogLevelService();
      expect(errorService.getDefaultLevel()).toBe('error');
    });

    it('falls back safely to "log" when LOG_LEVEL is invalid', () => {
      process.env.LOG_LEVEL = 'invalid_level';
      const invalidService = new LogLevelService();
      expect(invalidService.getDefaultLevel()).toBe('log');
      expect(invalidService.getEffectiveLevel()).toBe('log');
    });
  });

  describe('NestJS LogLevel mapping', () => {
    it('maps application levels to appropriate NestJS LogLevel arrays', () => {
      expect(LogLevelService.getNestLogLevels('error')).toEqual(['error', 'fatal']);
      expect(LogLevelService.getNestLogLevels('warn')).toEqual(['error', 'warn', 'fatal']);
      expect(LogLevelService.getNestLogLevels('log')).toEqual(['error', 'warn', 'log', 'fatal']);
      expect(LogLevelService.getNestLogLevels('debug')).toEqual([
        'error',
        'warn',
        'log',
        'debug',
        'fatal',
      ]);
      expect(LogLevelService.getNestLogLevels('verbose')).toEqual([
        'error',
        'warn',
        'log',
        'debug',
        'verbose',
        'fatal',
      ]);
    });
  });

  describe('dynamic runtime overrides and expiration', () => {
    it('sets debug level with duration and returns expiration metadata', () => {
      const startTime = new Date('2026-08-14T12:00:00.000Z');
      jest.useFakeTimers();
      jest.setSystemTime(startTime);

      const result = service.setLogLevel({
        level: 'debug',
        durationMinutes: 45,
        actorId: 'admin-1',
      });

      expect(result.currentLevel).toBe('debug');
      expect(result.defaultLevel).toBe('log');
      expect(result.updatedBy).toBe('admin-1');
      expect(result.expiresAt).toBe('2026-08-14T12:45:00.000Z');
      expect(service.getEffectiveLevel()).toBe('debug');
    });

    it('automatically defaults duration to 30 minutes for debug/verbose if not specified', () => {
      const startTime = new Date('2026-08-14T12:00:00.000Z');
      jest.useFakeTimers();
      jest.setSystemTime(startTime);

      const result = service.setLogLevel({
        level: 'verbose',
        actorId: 'super-admin',
      });

      expect(result.currentLevel).toBe('verbose');
      expect(result.expiresAt).toBe('2026-08-14T12:30:00.000Z');
    });

    it('expires override when duration passes and reverts to default level', () => {
      const startTime = new Date('2026-08-14T12:00:00.000Z');
      jest.useFakeTimers();
      jest.setSystemTime(startTime);

      service.setLogLevel({
        level: 'debug',
        durationMinutes: 10,
        actorId: 'admin-1',
      });
      expect(service.getEffectiveLevel()).toBe('debug');

      // Advance time by 11 minutes
      jest.advanceTimersByTime(11 * 60 * 1000);

      expect(service.getEffectiveLevel()).toBe('log');
      const status = service.getStatus();
      expect(status.currentLevel).toBe('log');
      expect(status.override).toBeUndefined();
    });

    it('resets log level override manually', () => {
      service.setLogLevel({
        level: 'warn',
        actorId: 'admin-1',
      });
      expect(service.getEffectiveLevel()).toBe('warn');

      service.resetLogLevel('admin-1');
      expect(service.getEffectiveLevel()).toBe('log');
    });

    it('emits structured telemetry log on level change', () => {
      const loggerSpy = jest.spyOn((service as any).logger, 'log').mockImplementation();

      service.setLogLevel({
        level: 'debug',
        durationMinutes: 15,
        actorId: 'admin-99',
      });

      expect(loggerSpy).toHaveBeenCalledTimes(1);
      const logged = JSON.parse(loggerSpy.mock.calls[0][0]);
      expect(logged).toEqual(
        expect.objectContaining({
          type: 'log_level_changed',
          previousLevel: 'log',
          newLevel: 'debug',
          actorId: 'admin-99',
        }),
      );
      expect(logged.expiresAt).toBeDefined();
    });
  });
});
