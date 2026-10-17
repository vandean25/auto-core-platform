import {
  ArgumentsHost,
  ConflictException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
  UnprocessableEntityException,
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
        traceId: '00000000-0000-4000-8000-000000000001',
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
        traceId: '00000000-0000-4000-8000-000000000001',
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
        traceId: '00000000-0000-4000-8000-000000000001',
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

    it('masks unexpected 5xx responses in production and names the request id', () => {
      process.env.NODE_ENV = 'production';
      const exception = new HttpException(
        'Database connection lost',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      TenantContextStorage.run(() => {
        TenantContextStorage.setRequestMeta({
          requestId: 'req-masked-1',
          traceId: '00000000-0000-4000-8000-000000000004',
          source: 'API',
        });
        filter.catch(exception, mockHost);
      });

      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          message: 'Something went wrong (ref: req-masked-1)',
          requestId: 'req-masked-1',
        }),
      );
      expect(mockJson.mock.calls[0][0]).not.toHaveProperty('code');
    });

    it('masks production 5xx even when operational is true without an allowlisted code', () => {
      process.env.NODE_ENV = 'production';
      const exception = new HttpException(
        {
          operational: true,
          message: 'database password leaked',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      filter.catch(exception, mockHost);

      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          message: 'Something went wrong',
        }),
      );
      expect(mockJson.mock.calls[0][0]).not.toHaveProperty('code');
    });

    it('preserves CHECK_IN_COMPLETED in production responses', () => {
      process.env.NODE_ENV = 'production';
      const exception = new ConflictException({
        code: 'CHECK_IN_COMPLETED',
        message: 'Completed check-in cannot be changed.',
      });
      filter.catch(exception, mockHost);

      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 409,
          code: 'CHECK_IN_COMPLETED',
        }),
      );
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

  it('does not forward code for non-allowlisted HttpException responses', () => {
    const exception = new UnprocessableEntityException({
      code: 'INTERNAL_LEDGER_STATE_UNLISTED',
      message: 'Ledger state is inconsistent.',
    });
    filter.catch(exception, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 422,
        message: 'Ledger state is inconsistent.',
      }),
    );
    expect(mockJson.mock.calls[0][0]).not.toHaveProperty('code');
  });

  it('forwards field_issues for listing readiness 422 responses', () => {
    const exception = new UnprocessableEntityException({
      code: 'VEHICLE_LISTING_NOT_READY',
      message: 'Listing is not ready for an active marketplace offer.',
      field_issues: [
        {
          field: 'vat_display',
          code: 'LISTING_VAT_DISPLAY_REQUIRED',
          message: 'VAT display (STANDARD or MARGIN) must be confirmed.',
        },
      ],
    });
    filter.catch(exception, mockHost);

    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 422,
        code: 'VEHICLE_LISTING_NOT_READY',
        field_issues: [
          { field: 'vat_display', code: 'LISTING_VAT_DISPLAY_REQUIRED' },
        ],
      }),
    );
  });

  it('adds the request id to 5xx bodies so the user can quote it', () => {
    TenantContextStorage.run(() => {
      TenantContextStorage.setRequestMeta({
        requestId: 'req-5xx-1',
        traceId: '00000000-0000-4000-8000-000000000002',
        source: 'API',
      });
      filter.catch(new Error('Unexpected failure'), mockHost);
    });

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 500, requestId: 'req-5xx-1' }),
    );
  });

  it('leaves the request id out of 4xx bodies', () => {
    TenantContextStorage.run(() => {
      TenantContextStorage.setRequestMeta({
        requestId: 'req-4xx-1',
        traceId: '00000000-0000-4000-8000-000000000003',
        source: 'API',
      });
      filter.catch(new ConflictException('Plain conflict'), mockHost);
    });

    expect(mockJson.mock.calls[0][0]).not.toHaveProperty('requestId');
  });

  it('forwards the order id and number for an active-order conflict', () => {
    filter.catch(
      new ConflictException({
        code: 'VEHICLE_HAS_ACTIVE_ORDER',
        message: 'Vehicle already has active order WO-2026-0007',
        orderId: 'wo-live',
        orderNumber: 'WO-2026-0007',
      }),
      mockHost,
    );

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(mockJson).toHaveBeenCalledWith({
      statusCode: 409,
      message: 'Vehicle already has active order WO-2026-0007',
      error: 'Conflict',
      code: 'VEHICLE_HAS_ACTIVE_ORDER',
      orderId: 'wo-live',
      orderNumber: 'WO-2026-0007',
    });
  });

  it('forwards the stable code of a 422 Gewährleistung shortening rejection', () => {
    filter.catch(
      new UnprocessableEntityException({
        code: 'GEWAEHRLEISTUNG_FIRST_REGISTRATION_REQUIRED',
        message: 'Für die Verkürzung ist das Datum der Erstzulassung erforderlich.',
      }),
      mockHost,
    );

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(mockJson).toHaveBeenCalledWith({
      statusCode: 422,
      message: 'Für die Verkürzung ist das Datum der Erstzulassung erforderlich.',
      error: 'Unprocessable Entity',
      code: 'GEWAEHRLEISTUNG_FIRST_REGISTRATION_REQUIRED',
    });
  });

  it('does not forward order fields for codes outside the allowlist', () => {
    filter.catch(
      new ConflictException({
        code: 'SOMETHING_ELSE',
        message: 'Conflict',
        orderId: 'wo-live',
      }),
      mockHost,
    );

    expect(mockJson.mock.calls[0][0]).not.toHaveProperty('orderId');
    expect(mockJson.mock.calls[0][0]).not.toHaveProperty('code');
  });
});
