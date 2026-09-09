import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

const PURCHASE_ORDER_STATUSES = [
  'DRAFT',
  'SENT',
  'PARTIAL',
  'COMPLETED',
  'open',
  'all',
] as const;

export class FindPurchaseOrdersQueryDto {
  @ApiPropertyOptional({
    enum: PURCHASE_ORDER_STATUSES,
  })
  @IsOptional()
  @IsString()
  @IsIn(PURCHASE_ORDER_STATUSES)
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sortField?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';
}
