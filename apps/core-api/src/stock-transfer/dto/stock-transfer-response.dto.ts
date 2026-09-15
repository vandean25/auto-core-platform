import { ApiProperty } from '@nestjs/swagger';
import { StockTransferStatus } from '@prisma/client';

export class StockTransferLineResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  catalogItemId!: string;

  @ApiProperty({ example: '5.000' })
  requestedQty!: string;

  @ApiProperty({ example: '5.000' })
  approvedQty!: string;

  @ApiProperty({ example: '5.000' })
  shippedQty!: string;

  @ApiProperty({ example: '5.000' })
  receivedQty!: string;

  @ApiProperty({ example: '0.000' })
  returnedQty!: string;

  @ApiProperty({ type: String, nullable: true })
  sourceLocationId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  destLocationId!: string | null;
}

export class StockTransferResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  transferNumber!: string;

  @ApiProperty()
  fromSiteId!: string;

  @ApiProperty({ type: String, nullable: true })
  fromSiteName!: string | null;

  @ApiProperty()
  toSiteId!: string;

  @ApiProperty({ type: String, nullable: true })
  toSiteName!: string | null;

  @ApiProperty({ enum: StockTransferStatus })
  status!: StockTransferStatus;

  @ApiProperty()
  version!: number;

  @ApiProperty()
  requestedByUserId!: string;

  @ApiProperty({ type: String, nullable: true })
  approvedByUserId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  shippedByUserId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  receivedByUserId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  rejectReason!: string | null;

  @ApiProperty({ type: String, nullable: true })
  cancelReason!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: [StockTransferLineResponseDto] })
  lines!: StockTransferLineResponseDto[];
}
