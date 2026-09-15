import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { SalesOrderStatus } from '@prisma/client';
import { CreateSalesOrderDto } from './create-sales-order.dto.js';

export class UpdateSalesOrderDto extends PartialType(CreateSalesOrderDto) {
  @ApiPropertyOptional({ enum: SalesOrderStatus, enumName: 'SalesOrderStatus' })
  @IsEnum(SalesOrderStatus)
  @IsOptional()
  status?: SalesOrderStatus;
}
