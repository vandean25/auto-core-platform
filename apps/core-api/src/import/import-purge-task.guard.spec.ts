import { describe, expect, it, beforeEach } from '@jest/globals';
import {
  InternalServerErrorException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { ImportPurgeTaskGuard } from './import-purge-task.guard.js';
import { signImportPurgeTaskPayload } from './import-purge-task.payload.js';

describe('ImportPurgeTaskGuard', () => {
  let guard: ImportPurgeTaskGuard;
  const secret = 'test-purge-secret';

  beforeEach(() => {
    process.env.CLOUD_TASKS_WORKER_SECRET = secret;
    guard = new ImportPurgeTaskGuard();
  });

  function createMockContext(body: unknown): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ body }),
      }),
    } as unknown as ExecutionContext;
  }

  it('allows request with valid signed payload', () => {
    const body = signImportPurgeTaskPayload(
      { runId: 'run-1', sequence: 0 },
      secret,
    );
    expect(guard.canActivate(createMockContext(body))).toBe(true);
  });

  it('throws UnauthorizedException when body is missing or null', () => {
    expect(() => guard.canActivate(createMockContext(null))).toThrow(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException when signature is invalid', () => {
    const body = {
      runId: 'run-1',
      sequence: 0,
      signature: 'invalid-hex-signature',
    };
    expect(() => guard.canActivate(createMockContext(body))).toThrow(
      UnauthorizedException,
    );
  });

  it('throws InternalServerErrorException when CLOUD_TASKS_WORKER_SECRET is not configured', () => {
    delete process.env.CLOUD_TASKS_WORKER_SECRET;
    expect(() =>
      guard.canActivate(createMockContext({ runId: 'r', sequence: 0 })),
    ).toThrow(InternalServerErrorException);
  });
});
