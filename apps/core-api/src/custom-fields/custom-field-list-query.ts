import {
  createParamDecorator,
  type ExecutionContext,
  type Type,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';

export const CUSTOM_FIELD_FILTER_DESCRIPTION =
  'Cursor lists and their capped counts accept tenant-defined `cf.<key>` parameters. Use `cf.<key>` or `cf.<key>[eq]` for equality, `[contains]` for text, `[gte]` and `[lte]` for inclusive numeric or YYYY-MM-DD bounds, repeated `[in]` for SELECT options, and `[is]=true|false` for booleans. Unknown and archived fields are ignored, as are all custom filters when custom fields are disabled. Invalid filters for active fields return HTTP 422 with `CUSTOM_FIELD_FILTER_INVALID`.';

const StaticListQuery = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    const { query } = context.switchToHttp().getRequest<Request>();
    return Object.fromEntries(
      Object.entries(query).filter(([name]) => !name.startsWith('cf.')),
    );
  },
);

/** Keep the regular query DTO strict while custom keys are validated against tenant definitions. */
export function CustomFieldListQuery(dto: Type<unknown>): ParameterDecorator {
  return StaticListQuery(
    new ValidationPipe({
      expectedType: dto,
      validateCustomDecorators: true,
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
}

export const CustomFieldFilterParams = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    const { originalUrl } = context.switchToHttp().getRequest<Request>();
    // Read the wire names independently of Express's bracket parser.
    const queryStart = originalUrl.indexOf('?');
    const params = new URLSearchParams();
    if (queryStart < 0) return params;
    for (const [name, value] of new URLSearchParams(
      originalUrl.slice(queryStart + 1),
    )) {
      if (name.startsWith('cf.')) params.append(name, value);
    }
    return params;
  },
);
