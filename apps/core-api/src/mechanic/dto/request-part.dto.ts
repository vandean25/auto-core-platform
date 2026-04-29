import { ApiProperty } from '@nestjs/swagger';
import { WorkshopPartLineExecutionStatus } from '@prisma/client';
import { IsNumber, IsString, Min } from 'class-validator';

/**
 * Payload for the parts requisition endpoint.
 *
 * The mechanic may only specify shop-floor context (SKU, description, qty).
 * Cost/price fields are intentionally excluded — mechanics must not see or
 * set financial data (ADR-0014 §8.2, §6.3).
 *
 * A new `WorkshopTaskLineItem` of type PART is created with
 * `part_execution_status = PENDING_PICK`. Stock is NOT deducted (ADR-0014 §6.1).
 */
export class RequestPartDto {
  @ApiProperty({ description: 'SKU / part number' })
  @IsString()
  itemNo!: string;

  @ApiProperty({ description: 'Part description' })
  @IsString()
  description!: string;

  @ApiProperty({ description: 'Quantity requested', minimum: 1 })
  @IsNumber()
  @Min(1)
  qty!: number;
}

export class RequestPartResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  itemNo!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty()
  qty!: number;

  @ApiProperty({ enum: WorkshopPartLineExecutionStatus })
  partExecutionStatus!: WorkshopPartLineExecutionStatus;
}
