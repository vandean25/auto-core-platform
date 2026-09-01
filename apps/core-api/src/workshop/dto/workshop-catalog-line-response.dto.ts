import { ApiProperty } from '@nestjs/swagger';
import {
  WorkshopLineItemType,
  WorkshopPartLineExecutionStatus,
} from '@prisma/client';

export class WorkshopCatalogLineItemResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: WorkshopLineItemType })
  type!: WorkshopLineItemType;

  @ApiProperty()
  itemNo!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty()
  qty!: number;

  @ApiProperty()
  unitPrice!: number;

  @ApiProperty({
    enum: WorkshopPartLineExecutionStatus,
    required: false,
    nullable: true,
  })
  partExecutionStatus?: WorkshopPartLineExecutionStatus | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  catalogItemId?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  sourceSystem?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  externalOperationCode?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  fitmentNotes?: string | null;

  @ApiProperty({ type: Number, required: false, nullable: true })
  costPriceEst?: number | null;

  @ApiProperty({ type: [String], required: false, nullable: true })
  oemNumbers?: string[] | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  laborCategoryId?: string | null;

  @ApiProperty({ type: Number, required: false, nullable: true })
  hourlyRateSnapshot?: number | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  catalogHitJti?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  laborOperationId?: string | null;

  @ApiProperty({ type: Number, required: false, nullable: true })
  standardAw?: number | null;

  @ApiProperty({ type: Number, required: false, nullable: true })
  actualHours?: number | null;

  @ApiProperty({ type: Number, required: false, nullable: true })
  internalCostRate?: number | null;
}

export class AddWorkshopTaskLineFromCatalogResponseDto {
  @ApiProperty({ type: () => WorkshopCatalogLineItemResponseDto })
  line!: WorkshopCatalogLineItemResponseDto;

  @ApiProperty()
  lineItemsVersion!: number;
}
