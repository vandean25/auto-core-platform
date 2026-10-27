import { Logger } from '@nestjs/common';
import { jest } from '@jest/globals';
import { ImportRecoveryService } from './import-recovery.service.js';
import type { ImportWorkerService } from './import-worker.service.js';

describe('ImportRecoveryService', () => {
  let warnSpy: jest.SpiedFunction<Logger['warn']>;
  let recoverStaleJobs: jest.MockedFunction<ImportWorkerService['recoverStaleJobs']>;
  let service: ImportRecoveryService;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    recoverStaleJobs = jest.fn();
    service = new ImportRecoveryService({
      recoverStaleJobs,
    } as unknown as ImportWorkerService);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('recover propagates errors from run (in-process @Cron path)', async () => {
    recoverStaleJobs.mockRejectedValue(new Error('lease sweep failed'));

    await expect(service.recover()).rejects.toThrow('lease sweep failed');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('run returns the lock boolean and propagates errors for HTTP invoke', async () => {
    recoverStaleJobs.mockResolvedValue(true);
    await expect(service.run()).resolves.toBe(true);

    recoverStaleJobs.mockResolvedValue(false);
    await expect(service.run()).resolves.toBe(false);

    recoverStaleJobs.mockRejectedValue(new Error('db down'));
    await expect(service.run()).rejects.toThrow('db down');
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
