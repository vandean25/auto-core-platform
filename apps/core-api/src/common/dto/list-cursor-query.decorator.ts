import { applyDecorators } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';

/** Shared OpenAPI queries for offset-style list endpoints (page/limit/sort). */
export function ApiListOffsetPaginationQueries(options?: {
  includeLimit?: boolean;
}) {
  const decorators = [
    ApiQuery({
      name: 'page',
      required: false,
      schema: { type: 'integer', minimum: 1 },
    }),
    ...(options?.includeLimit
      ? [
          ApiQuery({
            name: 'limit',
            required: false,
            schema: { type: 'integer', minimum: 1 },
          }),
        ]
      : []),
    ApiQuery({
      name: 'pageSize',
      required: false,
      schema: { type: 'integer', minimum: 1 },
    }),
    ApiQuery({
      name: 'sortField',
      required: false,
      schema: { type: 'string' },
    }),
    ApiQuery({
      name: 'sortDirection',
      required: false,
      schema: { type: 'string', enum: ['asc', 'desc'] },
    }),
  ];
  return applyDecorators(...decorators);
}

export function ApiListCursorModeQuery() {
  return applyDecorators(
    ApiQuery({
      name: 'pagination',
      required: false,
      description:
        'Use `cursor` for keyset paging (pilot). Omit or `offset` keeps the existing page/limit contract.',
      schema: { type: 'string', enum: ['offset', 'cursor'] },
    }),
    ApiQuery({
      name: 'cursor',
      required: false,
      description:
        'Opaque cursor from meta.nextCursor of the previous cursor page',
      schema: { type: 'string' },
    }),
  );
}
