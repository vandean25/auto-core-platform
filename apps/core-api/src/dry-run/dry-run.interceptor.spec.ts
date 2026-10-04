import { jest } from '@jest/globals';
import { BadRequestException, ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of, firstValueFrom } from 'rxjs';
import { DryRunInterceptor } from './dry-run.interceptor.js';
import { DryRunService } from './dry-run.service.js';
import { DRY_RUN_SUPPORTED_KEY, DRY_RUN_REFUSED_KEY } from './dry-run.constants.js';

describe('DryRunInterceptor', () => {
  let interceptor: DryRunInterceptor;
  let mockReflector: {
    getAllAndOverride: jest.Mock<
      (key: string, targets: [unknown, unknown]) => unknown
    >;
  };
  let mockDryRunService: {
    executeInRollbackTransaction: jest.Mock<
      (work: () => Promise<unknown>) => Promise<{ result: unknown; wouldChange: unknown[] }>
    >;
  };
  let mockExecutionContext: ExecutionContext;
  let mockCallHandler: CallHandler;
  let mockRequest: {
    query: Record<string, unknown>;
    headers: Record<string, string>;
  };
  let mockResponse: {
    setHeader: jest.Mock<(name: string, val: string) => void>;
  };
  let handlerFn: () => void;
  let classFn: () => void;

  beforeEach(() => {
    mockReflector = {
      getAllAndOverride: jest.fn(),
    };

    mockDryRunService = {
      executeInRollbackTransaction: jest.fn(),
    };

    mockRequest = {
      query: {},
      headers: {},
    };

    mockResponse = {
      setHeader: jest.fn(),
    };

    handlerFn = function mockHandler() {};
    classFn = function MockClass() {};

    mockExecutionContext = {
      getType: jest.fn().mockReturnValue('http'),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
      getHandler: () => handlerFn,
      getClass: () => classFn,
    } as unknown as ExecutionContext;

    mockCallHandler = {
      handle: jest.fn(),
    };

    interceptor = new DryRunInterceptor(
      mockReflector as unknown as Reflector,
      mockDryRunService as unknown as DryRunService,
    );
  });

  describe('when dry_run is NOT requested', () => {
    it('passes through to next.handle() when no dry_run query or header is present', async () => {
      mockCallHandler.handle = jest.fn().mockReturnValue(of({ success: true }));

      const result$ = interceptor.intercept(mockExecutionContext, mockCallHandler);
      const result = await firstValueFrom(result$);

      expect(result).toEqual({ success: true });
      expect(mockDryRunService.executeInRollbackTransaction).not.toHaveBeenCalled();
      expect(mockResponse.setHeader).not.toHaveBeenCalled();
    });

    it('passes through to next.handle() when dry_run=false', async () => {
      mockRequest.query.dry_run = 'false';
      mockCallHandler.handle = jest.fn().mockReturnValue(of({ success: true }));

      const result$ = interceptor.intercept(mockExecutionContext, mockCallHandler);
      const result = await firstValueFrom(result$);

      expect(result).toEqual({ success: true });
      expect(mockDryRunService.executeInRollbackTransaction).not.toHaveBeenCalled();
      expect(mockResponse.setHeader).not.toHaveBeenCalled();
    });

    it('passes through if execution context is not http', async () => {
      (mockExecutionContext.getType as jest.Mock).mockReturnValue('rpc');
      mockCallHandler.handle = jest.fn().mockReturnValue(of('rpc-data'));

      const result$ = interceptor.intercept(mockExecutionContext, mockCallHandler);
      const result = await firstValueFrom(result$);

      expect(result).toBe('rpc-data');
      expect(mockDryRunService.executeInRollbackTransaction).not.toHaveBeenCalled();
    });
  });

  describe('when dry_run is requested', () => {
    const enableDryRunQuery = () => {
      mockRequest.query.dry_run = 'true';
    };

    it('throws BadRequestException with DRY_RUN_NOT_SUPPORTED when endpoint lacks @DryRunSupported()', async () => {
      enableDryRunQuery();
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === DRY_RUN_SUPPORTED_KEY) return undefined;
        if (key === DRY_RUN_REFUSED_KEY) return undefined;
        return undefined;
      });

      await expect(
        firstValueFrom(interceptor.intercept(mockExecutionContext, mockCallHandler)),
      ).rejects.toThrow(BadRequestException);

      try {
        await firstValueFrom(interceptor.intercept(mockExecutionContext, mockCallHandler));
      } catch (err: unknown) {
        expect((err as BadRequestException).getResponse()).toEqual({
          message: 'DRY_RUN_NOT_SUPPORTED',
          code: 'DRY_RUN_NOT_SUPPORTED',
        });
      }

      expect(mockDryRunService.executeInRollbackTransaction).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when endpoint has @DryRunRefused()', async () => {
      enableDryRunQuery();
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === DRY_RUN_REFUSED_KEY) return { refused: true, reason: 'Fiscal finalization cannot be simulated' };
        if (key === DRY_RUN_SUPPORTED_KEY) return true; // even if supported is also set
        return undefined;
      });

      await expect(
        firstValueFrom(interceptor.intercept(mockExecutionContext, mockCallHandler)),
      ).rejects.toThrow(BadRequestException);

      try {
        await firstValueFrom(interceptor.intercept(mockExecutionContext, mockCallHandler));
      } catch (err: unknown) {
        expect((err as BadRequestException).getResponse()).toEqual({
          message: 'DRY_RUN_NOT_SUPPORTED',
          code: 'DRY_RUN_NOT_SUPPORTED',
        });
      }

      expect(mockDryRunService.executeInRollbackTransaction).not.toHaveBeenCalled();
    });

    it('recognizes dry_run from boolean query param (dry_run: true)', async () => {
      mockRequest.query.dry_run = true;
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === DRY_RUN_SUPPORTED_KEY) return true;
        return undefined;
      });

      mockDryRunService.executeInRollbackTransaction.mockImplementation(async (work) => {
        const result = await work();
        return { result, wouldChange: [] };
      });
      mockCallHandler.handle = jest.fn().mockReturnValue(of({ created: true }));

      const result$ = interceptor.intercept(mockExecutionContext, mockCallHandler);
      const res = await firstValueFrom(result$);

      expect(mockDryRunService.executeInRollbackTransaction).toHaveBeenCalled();
      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Dry-Run', 'true');
      expect(res).toEqual({
        created: true,
        dry_run: true,
        would_change: [],
      });
    });

    it('recognizes dry_run from X-Dry-Run header', async () => {
      mockRequest.headers['x-dry-run'] = 'true';
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === DRY_RUN_SUPPORTED_KEY) return true;
        return undefined;
      });

      mockDryRunService.executeInRollbackTransaction.mockImplementation(async (work) => {
        const result = await work();
        return { result, wouldChange: [] };
      });
      mockCallHandler.handle = jest.fn().mockReturnValue(of({ headerTest: true }));

      const result$ = interceptor.intercept(mockExecutionContext, mockCallHandler);
      const res = await firstValueFrom(result$);

      expect(mockDryRunService.executeInRollbackTransaction).toHaveBeenCalled();
      expect(res).toEqual({
        headerTest: true,
        dry_run: true,
        would_change: [],
      });
    });

    it('augments object response with dry_run and would_change', async () => {
      enableDryRunQuery();
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === DRY_RUN_SUPPORTED_KEY) return true;
        return undefined;
      });

      mockDryRunService.executeInRollbackTransaction.mockResolvedValue({
        result: { id: 'cust-1', name: 'Sample' },
        wouldChange: [{ entity: 'Customer', id: 'cust-1', op: 'create' }],
      });
      mockCallHandler.handle = jest.fn().mockReturnValue(of({ id: 'cust-1', name: 'Sample' }));

      const result$ = interceptor.intercept(mockExecutionContext, mockCallHandler);
      const res = await firstValueFrom(result$);

      expect(res).toEqual({
        id: 'cust-1',
        name: 'Sample',
        dry_run: true,
        would_change: [{ entity: 'Customer', id: 'cust-1', op: 'create' }],
      });
      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Dry-Run', 'true');
    });

    it('wraps array response in data property with dry_run and would_change', async () => {
      enableDryRunQuery();
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === DRY_RUN_SUPPORTED_KEY) return true;
        return undefined;
      });

      mockDryRunService.executeInRollbackTransaction.mockResolvedValue({
        result: [{ id: '1' }, { id: '2' }],
        wouldChange: [],
      });
      mockCallHandler.handle = jest.fn().mockReturnValue(of([{ id: '1' }, { id: '2' }]));

      const result$ = interceptor.intercept(mockExecutionContext, mockCallHandler);
      const res = await firstValueFrom(result$);

      expect(res).toEqual({
        data: [{ id: '1' }, { id: '2' }],
        dry_run: true,
        would_change: [],
      });
    });

    it('wraps primitive response in data property with dry_run and would_change', async () => {
      enableDryRunQuery();
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === DRY_RUN_SUPPORTED_KEY) return true;
        return undefined;
      });

      mockDryRunService.executeInRollbackTransaction.mockResolvedValue({
        result: 'deleted-successfully',
        wouldChange: [{ entity: 'Task', id: 'task-1', op: 'delete' }],
      });
      mockCallHandler.handle = jest.fn().mockReturnValue(of('deleted-successfully'));

      const result$ = interceptor.intercept(mockExecutionContext, mockCallHandler);
      const res = await firstValueFrom(result$);

      expect(res).toEqual({
        data: 'deleted-successfully',
        dry_run: true,
        would_change: [{ entity: 'Task', id: 'task-1', op: 'delete' }],
      });
    });

    it('propagates errors thrown during executeInRollbackTransaction', async () => {
      enableDryRunQuery();
      mockReflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === DRY_RUN_SUPPORTED_KEY) return true;
        return undefined;
      });

      const dbError = new BadRequestException('Invalid customer payload');
      mockDryRunService.executeInRollbackTransaction.mockRejectedValue(dbError);

      await expect(
        firstValueFrom(interceptor.intercept(mockExecutionContext, mockCallHandler)),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
