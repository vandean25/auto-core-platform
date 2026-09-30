import {
  ArgumentsHost,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalExceptionFilter } from './global-exception.filter.js';
import { TenantContextStorage } from '../services/tenant-context.storage.js';
import { ConflictError, NotFoundError } from '../errors/application-errors.js';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let mockStatus: jest.Mock;
  let mockJson: jest.Mock;
  let mockHost: ArgumentsHost;
  let mockLoggerError: jest.SpyInstance;
  let mockLoggerWarn: jest.SpyInstance;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnValue({ json: mockJson });

    mockHost = {
      switchToHttp: () => ({
        getResponse: () => ({
          status: mockStatus,
        }),
        getRequest: () => ({}),
      }),
    } as unknown as ArgumentsHost;

    mockLoggerError = jest.spyOn((filter as any).logger, 'error').mockImplementation();
    mockLoggerWarn = jest.spyOn((filter as any).logger, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('formats standard HttpException with structured response and logs context', () => {
    TenantContextStorage.run(() => {
      TenantContextStorage.setUser({
        userId: 'user-1',
        email: 'test@example.com',
        role: 'ADMIN',
        tenantId: 'tenant-123',
      });
      TenantContextStorage.setRequestMeta({
        requestId: 'req-404',
        source: 'API',
      });

      const exception = new HttpException('Resource not found', HttpStatus.NOT_FOUND);
      filter.catch(exception, mockHost);

      expect(mockStatus).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(mockJson).toHaveBeenCalledWith({
        statusCode: 404,
        message: 'Resource not found',
        error: 'Not Found',
      });
    });
  });

  it('logs structured 500 error with requestId and tenantId', () => {
    TenantContextStorage.run(() => {
      TenantContextStorage.setUser({
        userId: 'user-err',
        email: 'user@example.com',
        role: 'MANAGER',
        tenantId: 'tenant-999',
      });
      TenantContextStorage.setRequestMeta({
        requestId: 'req-unhandled',
        source: 'API',
      });

      const exception = new Error('Unexpected crash');
      filter.catch(exception, mockHost);

      expect(mockStatus).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(mockLoggerError).toHaveBeenCalledTimes(1);

      const loggedRaw = mockLoggerError.mock.calls[0][0];
      const logged = JSON.parse(loggedRaw);

      expect(logged).toEqual(
        expect.objectContaining({
          type: 'http_error',
          requestId: 'req-unhandled',
          statusCode: 500,
          errorName: 'Error',
          message: 'Unexpected crash',
          tenantId: 'tenant-999',
          actorId: 'user-err',
        }),
      );
    });
  });

  it('logs structured Prisma error with sanitized meta and requestId', () => {
    TenantContextStorage.run(() => {
      TenantContextStorage.setRequestMeta({
        requestId: 'req-prisma-1',
        source: 'API',
      });

      const prismaError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.0.0',
        meta: { target: ['email'] },
      });

      filter.catch(prismaError, mockHost);

      expect(mockStatus).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      expect(mockLoggerError).toHaveBeenCalledTimes(1);

      const loggedRaw = mockLoggerError.mock.calls[0][0];
      const logged = JSON.parse(loggedRaw);

      expect(logged).toEqual(
        expect.objectContaining({
          type: 'prisma_error',
          requestId: 'req-prisma-1',
          code: 'P2002',
          meta: { target: ['email'] },
        }),
      );
    });
  });

  it('handles Domain ApplicationErrors properly', () => {
    const exception = new ConflictError('Order conflict');
    filter.catch(exception, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 409,
        message: 'Order conflict',
        error: 'Conflict',
      }),
    );
  });

  describe('production 5xx masking', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('masks unexpected 5xx responses in production', () => {
      process.env.NODE_ENV = 'production';
      const exception = new HttpException(
        'Database connection lost',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      filter.catch(exception, mockHost);

      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          message: 'Internal server error',
        }),
      );
      expect(mockJson.mock.calls[0][0]).not.toHaveProperty('code');
    });

    it('preserves client-safe operational 503 codes and messages in production', () => {
      process.env.NODE_ENV = 'production';
      const exception = new ServiceUnavailableException({
        code: 'INVOICE_BRANDING_WRITER_DISABLED',
        message:
          'Invoice commitment is temporarily unavailable while branded invoice issuance is disabled.',
      });
      filter.catch(exception, mockHost);

      expect(mockStatus).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 503,
          message:
            'Invoice commitment is temporarily unavailable while branded invoice issuance is disabled.',
          code: 'INVOICE_BRANDING_WRITER_DISABLED',
        }),
      );
      expect(mockLoggerError).not.toHaveBeenCalled();
      expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
    });
  });
});
