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
}
