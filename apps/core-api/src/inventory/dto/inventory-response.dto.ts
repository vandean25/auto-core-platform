import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/paginated-response.dto';

export class AvailabilityCheckResultDto {
  @ApiProperty()
  sku!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  brand!: string;

  @ApiProperty({ type: String, required: false, nullable: true })
  original_sku?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  suggested_sku?: string | null;

  @ApiProperty()
  quantity_on_hand!: number;

  @ApiProperty()
  quantity_reserved!: number;

  @ApiProperty()
  quantity_available!: number;

  @ApiProperty()
  is_superseded!: boolean;
}

export class InventoryItemResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  sku!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  brand!: string;

  @ApiProperty({ type: Number, required: false, nullable: true })
  brand_id?: number | null;

  @ApiProperty()
  price!: number;

  @ApiProperty({ enum: ['IN_STOCK', 'OUT_OF_STOCK', 'SUPERSEDED'] })
  status!: 'IN_STOCK' | 'OUT_OF_STOCK' | 'SUPERSEDED';

  @ApiProperty()
  quantity_available!: number;

  @ApiProperty()
  warehouse_location!: string;
}

export class InventoryTransactionItemDto {
  @ApiProperty()
  sku!: string;

  @ApiProperty()
  name!: string;
}

export class InventoryTransactionLocationDto {
  @ApiProperty()
  name!: string;
}

export class InventoryTransactionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  quantity!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty({ type: String, required: false, nullable: true })
  reference_id?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  cost_basis?: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ type: InventoryTransactionItemDto })
  item!: InventoryTransactionItemDto;

  @ApiProperty({ type: InventoryTransactionLocationDto })
  location!: InventoryTransactionLocationDto;
}

export class InventoryPaginatedResponseDto {
  @ApiProperty({ type: [InventoryItemResponseDto] })
  data!: InventoryItemResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}

export class CatalogItemResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  sku!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  cost_price!: string;

  @ApiProperty()
  retail_price!: string;

  @ApiProperty()
  unit!: string;

  @ApiProperty({ type: Number, required: false, nullable: true })
  brand_id?: number | null;

  @ApiProperty({ type: Number, required: false, nullable: true })
  revenue_group_id?: number | null;
}
