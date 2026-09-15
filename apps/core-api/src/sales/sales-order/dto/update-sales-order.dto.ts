import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { SalesOrderStatus } from '@prisma/client';
import { CreateSalesOrderDto } from './create-sales-order.dto.js';

export class UpdateSalesOrderDto extends PartialType(CreateSalesOrderDto) {
  @ApiPropertyOptional({ enum: SalesOrderStatus, enumName: 'SalesOrderStatus' })
  @IsEnum(SalesOrderStatus)
  @IsOptional()
  status?: SalesOrderStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsUUID()
  @IsOptional()
  siteId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsUUID()
  @IsOptional()
  expectedSiteId?: string;
}
