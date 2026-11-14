import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class FindAllWorkshopOrdersQueryDto {
  @ApiPropertyOptional({
    description:
      'Free-text search term for order number, customer, plate, or vehicle',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ type: String, description: 'Page number' })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional({
    type: String,
    description: 'Number of items per page',
  })
  @IsOptional()
  @IsString()
  pageSize?: string;

  @ApiPropertyOptional({ description: 'Field name to sort by' })
  @IsOptional()
  @IsString()
  sortField?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], description: 'Sort direction' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';

  @ApiPropertyOptional({
    description:
      'When set, only orders for this customer are returned (open workshop statuses only).',
  })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({
    enum: ['offset', 'cursor'],
    description:
      'Use `cursor` for keyset paging (ADR-0035). Omit or `offset` keeps the page/pageSize contract. Cursor mode needs the X-ACP-Scope-Context header and rejects `page` / `pageSize`.',
  })
  @IsOptional()
  @IsIn(['offset', 'cursor'])
  pagination?: 'offset' | 'cursor';

  @ApiPropertyOptional({
    description:
      'Opaque cursor from meta.nextCursor of the previous cursor page (implies cursor mode).',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    type: String,
    description: 'Cursor mode only. Default 50, maximum 100.',
  })
  @IsOptional()
  @IsString()
  limit?: string;
}

export class WorkshopOrdersCappedCountQueryDto {
  @ApiPropertyOptional({
    description: 'Same search as the workshop order list',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description:
      'Same customer restriction as the list (open workshop statuses only).',
  })
  @IsOptional()
  @IsUUID()
  customerId?: string;
}
