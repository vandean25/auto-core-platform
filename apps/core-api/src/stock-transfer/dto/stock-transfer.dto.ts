import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StockTransferCommandAction } from '@prisma/client';

export class CreateStockTransferLineDto {
  @ApiProperty()
  @IsUUID()
  catalogItemId!: string;

  @ApiProperty({ example: 5 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  requestedQty!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sourceLocationId?: string;
}

export class CreateStockTransferDto {
  @ApiProperty()
  @IsUUID()
  fromSiteId!: string;

  @ApiProperty()
  @IsUUID()
  toSiteId!: string;

  @ApiProperty({ type: [CreateStockTransferLineDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreateStockTransferLineDto)
  lines!: CreateStockTransferLineDto[];
}

export class ApproveStockTransferLineDto {
  @ApiProperty()
  @IsUUID()
  id!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  approvedQty?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sourceLocationId?: string;
}

export class ApproveStockTransferDto {
  @ApiProperty({ type: Number })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ type: [ApproveStockTransferLineDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ApproveStockTransferLineDto)
  lines?: ApproveStockTransferLineDto[];
}

export class RejectStockTransferDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CancelStockTransferDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ShipStockTransferLineDto {
  @ApiProperty()
  @IsUUID()
  id!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sourceLocationId?: string;
}

export class ShipStockTransferDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ type: [ShipStockTransferLineDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ShipStockTransferLineDto)
  lines!: ShipStockTransferLineDto[];
}

export class ReceiveStockTransferLineDto {
  @ApiProperty()
  @IsUUID()
  id!: string;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  receiveQty!: number;

  @ApiProperty()
  @IsUUID()
  destLocationId!: string;
}

export class ReceiveStockTransferDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  idempotencyKey!: string;

  @ApiProperty({ type: [ReceiveStockTransferLineDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReceiveStockTransferLineDto)
  lines!: ReceiveStockTransferLineDto[];
}

export class ReturnStockTransferLineDto {
  @ApiProperty()
  @IsUUID()
  id!: string;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  returnQty!: number;
}

export class ReturnStockTransferDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  idempotencyKey!: string;

  @ApiProperty({ type: [ReturnStockTransferLineDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReturnStockTransferLineDto)
  lines!: ReturnStockTransferLineDto[];
}

export const STOCK_TRANSFER_COMMAND_ACTIONS: StockTransferCommandAction[] = [
  'RECEIVE',
  'RETURN',
] as const;

export class StockTransferCommandQueryDto {
  @ApiProperty({ enum: STOCK_TRANSFER_COMMAND_ACTIONS })
  @IsIn(STOCK_TRANSFER_COMMAND_ACTIONS)
  action!: StockTransferCommandAction;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  idempotencyKey!: string;
}
