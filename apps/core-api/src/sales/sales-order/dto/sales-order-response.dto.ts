import { ApiProperty } from '@nestjs/swagger';
import { SalesOrderStatus } from '@prisma/client';
import { PaginationMetaDto } from '../../../common/dto/paginated-response.dto';
import { CatalogItemResponseDto } from '../../../inventory/dto/inventory-response.dto';
import { CustomerResponseDto } from '../../../customer/dto/customer-response.dto';
import { VehicleResponseDto } from '../../../vehicle/dto/vehicle-response.dto';

export class SalesOrderInvoiceSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: String, required: false, nullable: true })
  invoice_number?: string | null;
}

export class SalesOrderItemResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: String, required: false, nullable: true })
  catalog_item_id?: string | null;

  @ApiProperty({
    type: () => CatalogItemResponseDto,
    required: false,
    nullable: true,
  })
  catalog_item?: CatalogItemResponseDto | null;

  @ApiProperty()
  description!: string;

  @ApiProperty({ type: String, example: '1.00' })
  quantity!: string;

  @ApiProperty({ type: String, example: '10.00' })
  unit_price!: string;

  @ApiProperty({ type: String, example: '10.00' })
  total!: string;

  @ApiProperty()
  tax_rate!: number;
}

export class SalesOrderResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  order_number!: string;

  @ApiProperty()
  customer_id!: string;

  @ApiProperty({ type: () => CustomerResponseDto })
  customer!: CustomerResponseDto;

  @ApiProperty({ type: String, required: false, nullable: true })
  vehicle_id?: string | null;

  @ApiProperty({
    type: () => VehicleResponseDto,
    required: false,
    nullable: true,
  })
  vehicle?: VehicleResponseDto | null;

  @ApiProperty({ enum: SalesOrderStatus, enumName: 'SalesOrderStatus' })
  status!: SalesOrderStatus;

  @ApiProperty({ type: String, example: '100.00' })
  total_amount!: string;

  @ApiProperty({ type: String, required: false, nullable: true })
  notes?: string | null;

  @ApiProperty({ type: [SalesOrderItemResponseDto] })
  items!: SalesOrderItemResponseDto[];

  @ApiProperty({
    type: () => SalesOrderInvoiceSummaryDto,
    required: false,
    nullable: true,
  })
  invoice?: SalesOrderInvoiceSummaryDto | null;

  @ApiProperty()
  createdAt!: Date;
}

export class SalesOrderPaginatedResponseDto {
  @ApiProperty({ type: [SalesOrderResponseDto] })
  data!: SalesOrderResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}
