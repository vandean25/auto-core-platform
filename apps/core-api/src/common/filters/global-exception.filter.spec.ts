import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { jest as esmJest } from '@jest/globals';
import { Prisma } from '@prisma/client';
import { TenantContextStorage } from '../services/tenant-context.storage.js';
import { ConflictError, NotFoundError } from '../errors/application-errors.js';

const mockCaptureException =
  esmJest.fn<(exception: unknown) => string | undefined>();
esmJest.unstable_mockModule('@sentry/node', () => ({
  captureException: mockCaptureException,
}));

const { GlobalExceptionFilter } = await import('./global-exception.filter.js');

function createBodyParserHttpError(options: {
  status: number;
  type: string;
  message: string;
  expose?: boolean;
}): Error {
  const error = new Error(options.message) as Error & {
    expose: boolean;
    status: number;
    statusCode: number;
    type: string;
  };
  error.expose = options.expose ?? true;
  error.status = options.status;
  error.statusCode = options.status;
  error.type = options.type;
  return error;
}

describe('GlobalExceptionFilter', () => {
  let filter: InstanceType<typeof GlobalExceptionFilter>;
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

  it('attaches an HTTP status fallback code for string HttpExceptions', () => {
    const exception = new HttpException(
      'inspected_on must be a valid date',
      HttpStatus.BAD_REQUEST,
    );
    filter.catch(exception, mockHost);

    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        code: 'HTTP_400',
        message: 'inspected_on must be a valid date',
      }),
    );
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
        code: 'HTTP_404',
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
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 409,
          code: 'PRISMA_P2002',
        }),
      );
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
        code: 'HTTP_409',
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
      expect(mockJson.mock.calls[0][0]).toMatchObject({ code: 'HTTP_500' });
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
      expect(mockJson.mock.calls[0][0]).toMatchObject({ code: 'HTTP_500' });
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

  it('uses an HTTP status fallback code for non-allowlisted HttpException responses', () => {
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
        code: 'HTTP_422',
      }),
    );
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
      params: {
        orderId: 'wo-live',
        orderNumber: 'WO-2026-0007',
      },
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

  it('forwards VEHICLE_PHOTO_TOO_LARGE on 413 responses', () => {
    const exception = new PayloadTooLargeException({
      code: 'VEHICLE_PHOTO_TOO_LARGE',
      message: 'Vehicle photo exceeds the 10 MiB upload limit.',
    });
    filter.catch(exception, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 413,
        code: 'VEHICLE_PHOTO_TOO_LARGE',
        message: 'Vehicle photo exceeds the 10 MiB upload limit.',
      }),
    );
  });

  it('forwards VEHICLE_PHOTO_TYPE_UNSUPPORTED on 415 responses', () => {
    const exception = new UnsupportedMediaTypeException({
      code: 'VEHICLE_PHOTO_TYPE_UNSUPPORTED',
      message: 'Vehicle photos must be JPEG, PNG, or WebP.',
    });
    filter.catch(exception, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 415,
        code: 'VEHICLE_PHOTO_TYPE_UNSUPPORTED',
        message: 'Vehicle photos must be JPEG, PNG, or WebP.',
      }),
    );
  });

  it('uses HTTP_413 when a 413 response has no domain code', () => {
    const exception = new PayloadTooLargeException('Payload too large');
    filter.catch(exception, mockHost);

    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 413,
        code: 'HTTP_413',
      }),
    );
  });

  it('uses HTTP_4XX for unmapped 4xx statuses', () => {
    const exception = new HttpException('Gone', HttpStatus.GONE);
    filter.catch(exception, mockHost);

    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 410,
        code: 'HTTP_4XX',
      }),
    );
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
    expect(mockJson.mock.calls[0][0]).toMatchObject({ code: 'HTTP_409' });
  });

  describe('body-parser http-errors (AUT-731)', () => {
    beforeEach(() => {
      mockCaptureException.mockReset();
    });

    it('maps entity.too.large to 413 without Sentry capture', () => {
      const exception = createBodyParserHttpError({
        status: 413,
        type: 'entity.too.large',
        message: 'request entity too large',
      });
      TenantContextStorage.run(() => {
        TenantContextStorage.setRequestMeta({
          requestId: 'req-413',
          traceId: '00000000-0000-4000-8000-000000000010',
          source: 'API',
        });
        filter.catch(exception, mockHost);
      });

      expect(mockStatus).toHaveBeenCalledWith(413);
      expect(mockJson).toHaveBeenCalledWith({
        statusCode: 413,
        message: 'request entity too large',
        error: 'Payload Too Large',
        code: 'HTTP_413',
      });
      expect(mockCaptureException).not.toHaveBeenCalled();
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        JSON.stringify({ type: 'entity.too.large', requestId: 'req-413' }),
      );
      expect(mockLoggerError).not.toHaveBeenCalled();
    });

    it('maps entity.parse.failed to 400 without Sentry capture', () => {
      const exception = createBodyParserHttpError({
        status: 400,
        type: 'entity.parse.failed',
        message: 'Unexpected token o in JSON at position 1',
      });
      filter.catch(exception, mockHost);

      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith({
        statusCode: 400,
        message: 'Unexpected token o in JSON at position 1',
        error: 'Bad Request',
        code: 'HTTP_400',
      });
      expect(mockCaptureException).not.toHaveBeenCalled();
    });

    it('maps encoding.unsupported to 415 without Sentry capture', () => {
      const exception = createBodyParserHttpError({
        status: 415,
        type: 'encoding.unsupported',
        message: 'unsupported content encoding "gzip"',
      });
      filter.catch(exception, mockHost);

      expect(mockStatus).toHaveBeenCalledWith(415);
      expect(mockJson).toHaveBeenCalledWith({
        statusCode: 415,
        message: 'unsupported content encoding "gzip"',
        error: 'Unsupported Media Type',
        code: 'HTTP_415',
      });
      expect(mockCaptureException).not.toHaveBeenCalled();
    });

    it('keeps expose=false 413 errors as 500 with Sentry capture', () => {
      mockCaptureException.mockReturnValue('evt-bp');
      const exception = createBodyParserHttpError({
        status: 413,
        type: 'entity.too.large',
        message: 'hidden',
        expose: false,
      });
      filter.catch(exception, mockHost);

      expect(mockStatus).toHaveBeenCalledWith(500);
      expect(mockCaptureException).toHaveBeenCalledWith(exception);
      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          code: 'HTTP_500',
          eventId: 'evt-bp',
        }),
      );
    });

    it('does not map expose=true 5xx body-parser errors', () => {
      mockCaptureException.mockReturnValue('evt-5xx-bp');
      const exception = createBodyParserHttpError({
        status: 503,
        type: 'entity.too.large',
        message: 'upstream',
      });
      filter.catch(exception, mockHost);

      expect(mockStatus).toHaveBeenCalledWith(500);
      expect(mockCaptureException).toHaveBeenCalledWith(exception);
    });
  });

  describe('handleHttpException characterization (AUT-672)', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    beforeEach(() => {
      mockCaptureException.mockReset();
    });

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
    });

    const body = () => mockJson.mock.calls[0][0] as Record<string, unknown>;

    const withContext = (
      ctx: { requestId?: string; tenantId?: string; userId?: string },
      run: () => void,
    ) =>
      TenantContextStorage.run(() => {
        if (ctx.tenantId || ctx.userId) {
          TenantContextStorage.setUser({
            userId: ctx.userId ?? 'user-x',
            email: 'ctx@example.com',
            role: 'ADMIN',
            tenantId: ctx.tenantId ?? 'tenant-x',
          });
        }
        if (ctx.requestId) {
          TenantContextStorage.setRequestMeta({
            requestId: ctx.requestId,
            traceId: '00000000-0000-4000-8000-000000000009',
            source: 'API',
          });
        }
        run();
      });

    describe('response format (non-production)', () => {
      it('keeps the key order statusCode, message, error, code, params details, eventId, requestId', () => {
        mockCaptureException.mockReturnValue('evt-order');
        withContext({ requestId: 'req-order' }, () =>
          filter.catch(
            new ServiceUnavailableException({
              code: 'VEHICLE_HAS_ACTIVE_ORDER',
              message: 'Busy',
              error: 'Service Unavailable',
              orderId: 'wo-1',
              orderNumber: 'WO-1',
            }),
            mockHost,
          ),
        );

        expect(Object.keys(body())).toEqual([
          'statusCode',
          'message',
          'error',
          'code',
          'orderId',
          'orderNumber',
          'params',
          'eventId',
          'requestId',
        ]);
      });

      it('formats a string response without an error field and names the status', () => {
        filter.catch(
          new HttpException('plain', HttpStatus.BAD_REQUEST),
          mockHost,
        );

        expect(mockStatus).toHaveBeenCalledWith(400);
        expect(body()).toEqual({
          statusCode: 400,
          message: 'plain',
          error: 'Bad Request',
          code: 'HTTP_400',
        });
      });

      it('takes message and error from an object response', () => {
        filter.catch(
          new BadRequestException({
            message: 'Invalid input',
            error: 'Custom Error',
          }),
          mockHost,
        );

        expect(body()).toEqual({
          statusCode: 400,
          message: 'Invalid input',
          error: 'Custom Error',
          code: 'HTTP_400',
        });
      });

      it('passes a validation-error message array through unchanged', () => {
        const messages = [
          'name must be a string',
          'qty must not be less than 1',
        ];
        filter.catch(
          new BadRequestException({
            statusCode: 400,
            message: messages,
            error: 'Bad Request',
          }),
          mockHost,
        );

        expect(body()).toEqual({
          statusCode: 400,
          message: messages,
          error: 'Bad Request',
          code: 'HTTP_400',
        });
      });

      it('falls back to the exception message when the object response has a falsy message', () => {
        filter.catch(
          new HttpException(
            { message: null, error: 'Teapot' },
            HttpStatus.I_AM_A_TEAPOT,
          ),
          mockHost,
        );

        expect(body()).toEqual({
          statusCode: 418,
          message: 'Http Exception',
          error: 'Teapot',
          code: 'HTTP_4XX',
        });
      });

      it('falls back to the exception message when the object response has no message', () => {
        filter.catch(
          new HttpException({ error: 'Teapot' }, HttpStatus.I_AM_A_TEAPOT),
          mockHost,
        );

        expect(body()).toMatchObject({
          message: 'Http Exception',
          error: 'Teapot',
        });
      });

      it('names the status when the object response has no error', () => {
        filter.catch(
          new BadRequestException({ message: 'No error field' }),
          mockHost,
        );

        expect(body()).toEqual({
          statusCode: 400,
          message: 'No error field',
          error: 'Bad Request',
          code: 'HTTP_400',
        });
      });

      it('names unmapped statuses from the HttpStatus enum, or Error when unknown', () => {
        filter.catch(new HttpException('Gone', HttpStatus.GONE), mockHost);
        expect(body()).toMatchObject({ statusCode: 410, error: 'GONE' });

        mockJson.mockClear();
        filter.catch(new HttpException('Odd', 499), mockHost);
        expect(body()).toMatchObject({ statusCode: 499, error: 'Error' });
      });

      it('keeps an allowlisted code on a 4xx response', () => {
        filter.catch(
          new ConflictException({ code: 'CHECK_IN_EXISTS', message: 'Exists' }),
          mockHost,
        );

        expect(body()).toEqual({
          statusCode: 409,
          message: 'Exists',
          error: 'Conflict',
          code: 'CHECK_IN_EXISTS',
        });
      });

      it('ignores a non-string code and a non-allowlisted code on a 4xx response', () => {
        filter.catch(
          new ConflictException({ code: 42, message: 'Numeric' }),
          mockHost,
        );
        expect(body()).toMatchObject({ code: 'HTTP_409' });

        mockJson.mockClear();
        filter.catch(
          new ConflictException({
            code: 'NOT_ON_THE_LIST',
            message: 'Unlisted',
          }),
          mockHost,
        );
        expect(body()).toMatchObject({ code: 'HTTP_409', message: 'Unlisted' });
      });

      it('forwards allowlisted order fields as flat keys and as params', () => {
        filter.catch(
          new ConflictException({
            code: 'VEHICLE_HAS_ACTIVE_ORDER',
            message: 'Active order',
            params: { orderNumber: 'WO-7' },
            orderId: 'wo-7',
          }),
          mockHost,
        );

        expect(body()).toEqual({
          statusCode: 409,
          message: 'Active order',
          error: 'Conflict',
          code: 'VEHICLE_HAS_ACTIVE_ORDER',
          orderId: 'wo-7',
          orderNumber: 'WO-7',
          params: { orderId: 'wo-7', orderNumber: 'WO-7' },
        });
      });

      it('omits params and detail keys when an allowlisted code carries no allowed fields', () => {
        filter.catch(
          new ConflictException({
            code: 'VEHICLE_HAS_ACTIVE_ORDER',
            message: 'Active order',
            orderId: 99,
          }),
          mockHost,
        );

        expect(body()).toEqual({
          statusCode: 409,
          message: 'Active order',
          error: 'Conflict',
          code: 'VEHICLE_HAS_ACTIVE_ORDER',
        });
      });

      it('forwards sanitized field_issues only for VEHICLE_LISTING_NOT_READY', () => {
        filter.catch(
          new UnprocessableEntityException({
            code: 'VEHICLE_LISTING_NOT_READY',
            message: 'Not ready',
            field_issues: [
              {
                field: 'price',
                code: 'LISTING_PRICE_REQUIRED',
                message: 'secret text',
              },
              { code: 'NO_FIELD' },
            ],
          }),
          mockHost,
        );
        expect(body()).toEqual({
          statusCode: 422,
          message: 'Not ready',
          error: 'Unprocessable Entity',
          code: 'VEHICLE_LISTING_NOT_READY',
          field_issues: [{ field: 'price', code: 'LISTING_PRICE_REQUIRED' }],
        });

        mockJson.mockClear();
        filter.catch(
          new UnprocessableEntityException({
            code: 'LISTING_PRICE_REQUIRED',
            message: 'Other code',
            field_issues: [{ field: 'price' }],
          }),
          mockHost,
        );
        expect(body()).not.toHaveProperty('field_issues');
      });

      it('does not log or mask a 5xx response outside production', () => {
        withContext({ requestId: 'req-dev-5xx', tenantId: 't-1' }, () =>
          filter.catch(
            new HttpException(
              {
                code: 'NOT_ON_THE_LIST',
                message: 'Leaky detail',
                orderId: 'wo-1',
              },
              HttpStatus.INTERNAL_SERVER_ERROR,
            ),
            mockHost,
          ),
        );

        expect(mockLoggerError).not.toHaveBeenCalled();
        expect(mockLoggerWarn).not.toHaveBeenCalled();
        expect(body()).toEqual({
          statusCode: 500,
          message: 'Leaky detail',
          error: 'Internal Server Error',
          code: 'HTTP_500',
          requestId: 'req-dev-5xx',
        });
      });

      it('keeps an allowlisted code on a 5xx response outside production', () => {
        filter.catch(
          new ServiceUnavailableException({
            code: 'INVOICE_BRANDING_WRITER_DISABLED',
            message: 'Disabled',
          }),
          mockHost,
        );

        expect(mockLoggerWarn).not.toHaveBeenCalled();
        expect(body()).toMatchObject({
          statusCode: 503,
          message: 'Disabled',
          code: 'INVOICE_BRANDING_WRITER_DISABLED',
        });
      });
    });

    describe('production logging and masking', () => {
      beforeEach(() => {
        process.env.NODE_ENV = 'production';
      });

      it('does not log or mask a 4xx response', () => {
        withContext({ requestId: 'req-prod-4xx', tenantId: 't-1' }, () =>
          filter.catch(
            new ConflictException({
              code: 'NOT_ON_THE_LIST',
              message: 'Visible 4xx',
            }),
            mockHost,
          ),
        );

        expect(mockLoggerError).not.toHaveBeenCalled();
        expect(mockLoggerWarn).not.toHaveBeenCalled();
        expect(body()).toEqual({
          statusCode: 409,
          message: 'Visible 4xx',
          error: 'Conflict',
          code: 'HTTP_409',
        });
      });

      it('masks and logs an unexpected 5xx with the stack, code and tenant context', () => {
        const exception = new HttpException(
          {
            code: 'NOT_ON_THE_LIST',
            message: 'Body detail',
            error: 'Custom Error',
            orderId: 'wo-1',
          },
          HttpStatus.BAD_GATEWAY,
        );
        withContext(
          { requestId: 'req-mask', tenantId: 'tenant-7', userId: 'user-7' },
          () => filter.catch(exception, mockHost),
        );

        expect(mockLoggerWarn).not.toHaveBeenCalled();
        expect(mockLoggerError).toHaveBeenCalledTimes(1);
        expect(mockLoggerError).toHaveBeenCalledWith(
          JSON.stringify({
            type: 'http_error',
            requestId: 'req-mask',
            statusCode: 502,
            errorName: 'HttpException',
            message: exception.message,
            code: 'NOT_ON_THE_LIST',
            tenantId: 'tenant-7',
            actorId: 'user-7',
          }),
          exception.stack,
        );
        expect(body()).toEqual({
          statusCode: 502,
          message: 'Something went wrong (ref: req-mask)',
          error: 'Custom Error',
          code: 'HTTP_502',
          requestId: 'req-mask',
        });
      });

      it('leaves optional log fields and the request id out when there is no context', () => {
        const exception = new HttpException(
          'Boom',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
        filter.catch(exception, mockHost);

        expect(mockLoggerError).toHaveBeenCalledWith(
          JSON.stringify({
            type: 'http_error',
            statusCode: 500,
            errorName: 'HttpException',
            message: 'Boom',
          }),
          exception.stack,
        );
        expect(body()).toEqual({
          statusCode: 500,
          message: 'Something went wrong',
          error: 'Internal Server Error',
          code: 'HTTP_500',
        });
      });

      it('logs tenant and actor without a request id when only the user is known', () => {
        const exception = new HttpException(
          'Boom',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
        withContext({ tenantId: 'tenant-8', userId: 'user-8' }, () =>
          filter.catch(exception, mockHost),
        );

        expect(mockLoggerError).toHaveBeenCalledWith(
          JSON.stringify({
            type: 'http_error',
            statusCode: 500,
            errorName: 'HttpException',
            message: 'Boom',
            tenantId: 'tenant-8',
            actorId: 'user-8',
          }),
          exception.stack,
        );
        expect(body()).not.toHaveProperty('requestId');
      });

      it('warns without the stack and keeps code, message and details for a client-safe 5xx', () => {
        const exception = new ServiceUnavailableException({
          code: 'INVOICE_BRANDING_WRITER_DISABLED',
          message: 'Temporarily unavailable',
        });
        withContext(
          { requestId: 'req-safe', tenantId: 'tenant-9', userId: 'user-9' },
          () => filter.catch(exception, mockHost),
        );

        expect(mockLoggerError).not.toHaveBeenCalled();
        expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
        expect(mockLoggerWarn).toHaveBeenCalledWith(
          JSON.stringify({
            type: 'http_error',
            requestId: 'req-safe',
            statusCode: 503,
            errorName: 'ServiceUnavailableException',
            message: exception.message,
            code: 'INVOICE_BRANDING_WRITER_DISABLED',
            tenantId: 'tenant-9',
            actorId: 'user-9',
          }),
        );
        expect(body()).toEqual({
          statusCode: 503,
          message: 'Temporarily unavailable',
          error: 'SERVICE_UNAVAILABLE',
          code: 'INVOICE_BRANDING_WRITER_DISABLED',
          requestId: 'req-safe',
        });
      });

      it('treats a generic allowlisted 5xx code as client-safe', () => {
        filter.catch(
          new HttpException(
            { code: 'HTTP_503', message: 'Upstream down' },
            HttpStatus.SERVICE_UNAVAILABLE,
          ),
          mockHost,
        );

        expect(mockLoggerError).not.toHaveBeenCalled();
        expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
        expect(body()).toMatchObject({
          message: 'Upstream down',
          code: 'HTTP_503',
        });
      });
    });

    describe('Sentry capture', () => {
      it('does not capture a 4xx response', () => {
        filter.catch(new HttpException('Odd client error', 499), mockHost);
        filter.catch(new ConflictException('Plain conflict'), mockHost);

        expect(mockCaptureException).not.toHaveBeenCalled();
        expect(body()).not.toHaveProperty('eventId');
      });

      it('captures the exception itself on 500 and above and returns the event id', () => {
        mockCaptureException.mockReturnValue('evt-1');
        const exception = new HttpException(
          'Boom',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
        filter.catch(exception, mockHost);

        expect(mockCaptureException).toHaveBeenCalledTimes(1);
        expect(mockCaptureException).toHaveBeenCalledWith(exception);
        expect(body()).toMatchObject({ statusCode: 500, eventId: 'evt-1' });

        mockCaptureException.mockClear();
        const gatewayTimeout = new HttpException(
          'Slow',
          HttpStatus.GATEWAY_TIMEOUT,
        );
        filter.catch(gatewayTimeout, mockHost);
        expect(mockCaptureException).toHaveBeenCalledWith(gatewayTimeout);
      });

      it('captures the original exception even when the response is masked in production', () => {
        process.env.NODE_ENV = 'production';
        mockCaptureException.mockReturnValue('evt-prod');
        const exception = new HttpException(
          'Secret detail',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
        filter.catch(exception, mockHost);

        expect(mockCaptureException).toHaveBeenCalledTimes(1);
        expect(mockCaptureException).toHaveBeenCalledWith(exception);
        expect(body()).toMatchObject({
          message: 'Something went wrong',
          eventId: 'evt-prod',
        });
      });

      it('captures a client-safe 5xx too', () => {
        process.env.NODE_ENV = 'production';
        const exception = new ServiceUnavailableException({
          code: 'INVOICE_BRANDING_WRITER_DISABLED',
          message: 'Disabled',
        });
        filter.catch(exception, mockHost);

        expect(mockCaptureException).toHaveBeenCalledWith(exception);
      });

      it('omits the event id when capture returns nothing or throws', () => {
        mockCaptureException.mockReturnValueOnce(undefined);
        filter.catch(
          new HttpException('Boom', HttpStatus.INTERNAL_SERVER_ERROR),
          mockHost,
        );
        expect(body()).not.toHaveProperty('eventId');

        mockJson.mockClear();
        mockCaptureException.mockReturnValueOnce('');
        filter.catch(
          new HttpException('Boom', HttpStatus.INTERNAL_SERVER_ERROR),
          mockHost,
        );
        expect(body()).not.toHaveProperty('eventId');

        mockJson.mockClear();
        mockCaptureException.mockImplementationOnce(() => {
          throw new Error('sentry down');
        });
        filter.catch(
          new HttpException('Boom', HttpStatus.INTERNAL_SERVER_ERROR),
          mockHost,
        );
        expect(mockStatus).toHaveBeenLastCalledWith(500);
        expect(body()).not.toHaveProperty('eventId');
      });
    });

    describe('PDF download cache headers', () => {
      const hostWith = (request: object, setHeader: jest.Mock) =>
        ({
          switchToHttp: () => ({
            getRequest: () => request,
            getResponse: () => ({ status: mockStatus, setHeader }),
          }),
        }) as unknown as ArgumentsHost;

      it('marks an error response for a GET pdf download as no-store', () => {
        const setHeader = jest.fn();
        filter.catch(
          new HttpException('Missing', HttpStatus.NOT_FOUND),
          hostWith({ method: 'GET', path: '/api/invoices/1/pdf' }, setHeader),
        );

        expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
        expect(setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
        expect(mockStatus).toHaveBeenCalledWith(404);
      });

      it('leaves cache headers alone for other requests', () => {
        const setHeader = jest.fn();
        filter.catch(
          new HttpException('Missing', HttpStatus.NOT_FOUND),
          hostWith({ method: 'GET', path: '/api/invoices/1' }, setHeader),
        );

        expect(setHeader).not.toHaveBeenCalled();
      });
    });
  });
});
