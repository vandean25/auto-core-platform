import { ApiProperty } from '@nestjs/swagger';
import { PurchaseOrderStatus } from '@prisma/client';
import { PaginationMetaDto } from '../../common/dto/paginated-response.dto';
import { CatalogItemResponseDto } from '../../inventory/dto/inventory-response.dto';
import { VendorResponseDto } from '../../vendor/dto/vendor-response.dto';

export class PurchaseOrderItemResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  catalog_item_id!: string;

  @ApiProperty({
    type: () => CatalogItemResponseDto,
    required: false,
  })
  catalog_item?: CatalogItemResponseDto;

  @ApiProperty()
  quantity!: number;

  @ApiProperty()
  quantity_received!: number;

  @ApiProperty({ type: String, example: '12.50' })
  unit_cost!: string;
}

export class PurchaseOrderResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  vendor_id!: string;

  @ApiProperty({ type: () => VendorResponseDto })
  vendor!: VendorResponseDto;

  @ApiProperty({
    enum: PurchaseOrderStatus,
    enumName: 'PurchaseOrderStatus',
  })
  status!: PurchaseOrderStatus;

  @ApiProperty()
  order_number!: string;

  @ApiProperty({ type: [PurchaseOrderItemResponseDto] })
  items!: PurchaseOrderItemResponseDto[];

  @ApiProperty()
  createdAt!: Date;
}

export class PurchaseOrderPaginatedResponseDto {
  @ApiProperty({ type: [PurchaseOrderResponseDto] })
  data!: PurchaseOrderResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}
