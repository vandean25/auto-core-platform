import { InternalServerErrorException } from '@nestjs/common';
import {
  resolvePdfGenerationDispatch,
  enqueueOrGeneratePdf,
} from './pdf-generation-dispatch';

describe('resolvePdfGenerationDispatch', () => {
  it('returns enqueue when Cloud Tasks is enabled and target base URL is set', () => {
    expect(
      resolvePdfGenerationDispatch({
        cloudTasksEnabled: true,
        targetBaseUrl: 'https://worker.example.com/api',
        nodeEnv: 'production',
      }),
    ).toBe('enqueue');
  });

  it('throws in production when Cloud Tasks is not fully configured', () => {
    expect(() =>
      resolvePdfGenerationDispatch({
        cloudTasksEnabled: false,
        targetBaseUrl: 'https://worker.example.com/api',
        nodeEnv: 'production',
      }),
    ).toThrow(InternalServerErrorException);

    expect(() =>
      resolvePdfGenerationDispatch({
        cloudTasksEnabled: true,
        targetBaseUrl: '',
        nodeEnv: 'production',
      }),
    ).toThrow(InternalServerErrorException);
  });

  it('returns inline in non-production when Cloud Tasks is not configured', () => {
    expect(
      resolvePdfGenerationDispatch({
        cloudTasksEnabled: false,
        targetBaseUrl: '',
        nodeEnv: 'development',
      }),
    ).toBe('inline');

    expect(
      resolvePdfGenerationDispatch({
        cloudTasksEnabled: false,
        targetBaseUrl: '',
        nodeEnv: 'test',
      }),
    ).toBe('inline');
  });
});

describe('enqueueOrGeneratePdf', () => {
  const defaultParams = {
    kind: 'workshop-order' as const,
    resourceId: 'order-1',
    resourceName: 'workshop order',
    tenantId: 'tenant-1',
    targetBaseUrl: 'https://worker.example.com/api',
    cloudTasks: {
      isEnabled: jest.fn(),
      enqueuePdfGeneration: jest.fn(),
    },
    logger: {
      warn: jest.fn(),
      error: jest.fn(),
    },
    clearError: jest.fn().mockResolvedValue(undefined),
    generateInline: jest.fn().mockResolvedValue({ generated: true }),
    storeEnqueueError: jest.fn().mockResolvedValue(undefined),
    onEnqueueError: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('generates inline directly when dispatch resolves to inline', async () => {
    defaultParams.cloudTasks.isEnabled.mockReturnValue(false);

    const result = await enqueueOrGeneratePdf({
      ...defaultParams,
      nodeEnv: 'development',
    });

    expect(result).toEqual({
      mode: 'generated',
      result: { generated: true },
    });
    expect(defaultParams.generateInline).toHaveBeenCalledTimes(1);
    expect(
      defaultParams.cloudTasks.enqueuePdfGeneration,
    ).not.toHaveBeenCalled();
    expect(defaultParams.clearError).not.toHaveBeenCalled();
  });

  it('clears error and enqueues task when cloud tasks is enabled', async () => {
    defaultParams.cloudTasks.isEnabled.mockReturnValue(true);
    defaultParams.cloudTasks.enqueuePdfGeneration.mockResolvedValue({
      taskId: 'task-123',
    });

    const result = await enqueueOrGeneratePdf({
      ...defaultParams,
      nodeEnv: 'production',
    });

    expect(result).toEqual({
      mode: 'enqueued',
      taskId: 'task-123',
    });
    expect(defaultParams.clearError).toHaveBeenCalledTimes(1);
    expect(defaultParams.cloudTasks.enqueuePdfGeneration).toHaveBeenCalledWith({
      kind: 'workshop-order',
      resourceId: 'order-1',
      tenantId: 'tenant-1',
      targetBaseUrl: 'https://worker.example.com/api',
    });
    expect(defaultParams.generateInline).not.toHaveBeenCalled();
  });

  it('warns but proceeds with enqueue if clearing error throws', async () => {
    defaultParams.cloudTasks.isEnabled.mockReturnValue(true);
    defaultParams.clearError.mockRejectedValueOnce(
      new Error('db connection error'),
    );
    defaultParams.cloudTasks.enqueuePdfGeneration.mockResolvedValue({
      taskId: 'task-456',
    });

    const result = await enqueueOrGeneratePdf({
      ...defaultParams,
      nodeEnv: 'production',
    });

    expect(result).toEqual({
      mode: 'enqueued',
      taskId: 'task-456',
    });
    expect(defaultParams.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Failed to clear workshop order PDF generation error',
      ),
    );
  });

  it('falls back to inline generation in non-production if enqueue fails', async () => {
    defaultParams.cloudTasks.isEnabled.mockReturnValue(true);
    defaultParams.cloudTasks.enqueuePdfGeneration.mockRejectedValue(
      new Error('Cloud tasks unavailable'),
    );

    const result = await enqueueOrGeneratePdf({
      ...defaultParams,
      nodeEnv: 'development',
    });

    expect(result).toEqual({
      mode: 'generated',
      result: { generated: true },
    });
    expect(defaultParams.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Falling back to inline generation'),
    );
    expect(defaultParams.generateInline).toHaveBeenCalledTimes(1);
    expect(defaultParams.onEnqueueError).toHaveBeenCalledTimes(1);
  });

  it('stores error and throws InternalServerErrorException in production if enqueue fails', async () => {
    defaultParams.cloudTasks.isEnabled.mockReturnValue(true);
    defaultParams.cloudTasks.enqueuePdfGeneration.mockRejectedValue(
      new Error('Cloud tasks unavailable in prod'),
    );

    await expect(
      enqueueOrGeneratePdf({
        ...defaultParams,
        nodeEnv: 'production',
      }),
    ).rejects.toThrow(InternalServerErrorException);

    expect(defaultParams.storeEnqueueError).toHaveBeenCalledWith(
      'Failed to enqueue background PDF generation task. Please try again.',
    );
    expect(defaultParams.generateInline).not.toHaveBeenCalled();
    expect(defaultParams.onEnqueueError).toHaveBeenCalledTimes(1);
  });
});
