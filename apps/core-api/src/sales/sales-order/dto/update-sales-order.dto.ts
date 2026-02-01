import { PartialType } from '@nestjs/mapped-types';
import { CreateSalesOrderDto } from './create-sales-order.dto';
import { IsEnum, IsOptional } from 'class-validator';
import { SalesOrderStatus } from '@prisma/client';

export class UpdateSalesOrderDto extends PartialType(CreateSalesOrderDto) {
  @IsEnum(SalesOrderStatus)
  @IsOptional()
  status?: SalesOrderStatus;
}
