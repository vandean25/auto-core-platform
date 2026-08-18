import { Test, TestingModule } from '@nestjs/testing';
import { AdminLogLevelController } from './admin-log-level.controller';
import { LogLevelService } from '../common/logging/log-level.service';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';

describe('AdminLogLevelController', () => {
  let controller: AdminLogLevelController;
  let logLevelService: LogLevelService;

  beforeEach(async () => {
    delete process.env.LOG_LEVEL;
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminLogLevelController],
      providers: [LogLevelService],
    }).compile();

    controller = module.get<AdminLogLevelController>(AdminLogLevelController);
    logLevelService = module.get<LogLevelService>(LogLevelService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('gets current log level status', () => {
    const status = controller.getLogLevel();
    expect(status.currentLevel).toBe('log');
    expect(status.defaultLevel).toBe('log');
    expect(status.override).toBeUndefined();
  });

  it('updates log level with duration and actor context', () => {
    const req = {
      user: {
        userId: 'admin-super-1',
        email: 'super@admin.com',
        platformRole: 'SUPER_ADMIN',
      },
    } as Request & { user?: AuthenticatedUser };

    const result = controller.updateLogLevel(
      {
        level: 'debug',
        durationMinutes: 60,
      },
      req,
    );

    expect(result.currentLevel).toBe('debug');
    expect(result.defaultLevel).toBe('log');
    expect(result.override).toBeDefined();
    expect(result.override?.level).toBe('debug');
    expect(result.override?.updatedBy).toBe('admin-super-1');
  });
});
