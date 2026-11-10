import { ApiProperty } from '@nestjs/swagger';
import { InventoryPriceOperationState } from '@prisma/client';
import { IsNumber, IsUUID, Min } from 'class-validator';
import { ListCursorPageMetaDto } from '../../common/dto/list-cursor-response.dto.js';

export class InventoryPriceOperationDto {
  @ApiProperty({ format: 'uuid' })
  key!: string;

  @ApiProperty({ format: 'uuid' })
  itemId!: string;

  @ApiProperty()
  sku!: string;

  @ApiProperty({ enum: InventoryPriceOperationState })
  state!: InventoryPriceOperationState;

  @ApiProperty()
  kind!: string;

  @ApiProperty({ type: 'integer', format: 'int64' })
  expectedRevision!: number;

  @ApiProperty({ description: 'Target price in major units (decimal string)' })
  retail_price!: string;

  @ApiProperty({
    description: 'Original basis price in major units (decimal string)',
  })
  basis_retail_price!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  acceptedAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  finalAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  errorCode!: string | null;
}

export class InventoryPriceOperationListResponseDto {
  @ApiProperty({ type: [InventoryPriceOperationDto] })
  data!: InventoryPriceOperationDto[];

  @ApiProperty({ type: () => ListCursorPageMetaDto })
  meta!: ListCursorPageMetaDto;
}

export class UserFenceInventoryPriceDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  itemId!: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  retail_price!: number;

  @ApiProperty({ type: 'integer', format: 'int64' })
  @IsNumber()
  expectedRevision!: number;
}
