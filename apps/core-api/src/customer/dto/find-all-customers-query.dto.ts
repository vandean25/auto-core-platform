import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class FindAllCustomersQueryDto {
  @ApiPropertyOptional({
    description:
      'Free-text search term for customer name, company name, email, or legacy ID',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ['PRIVATE', 'COMPANY'] })
  @IsOptional()
  @IsIn(['PRIVATE', 'COMPANY'])
  type?: 'PRIVATE' | 'COMPANY';

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

export class CustomersCappedCountQueryDto {
  @ApiPropertyOptional({
    description: 'Same search as the customer list',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ['PRIVATE', 'COMPANY'] })
  @IsOptional()
  @IsIn(['PRIVATE', 'COMPANY'])
  type?: 'PRIVATE' | 'COMPANY';
}
