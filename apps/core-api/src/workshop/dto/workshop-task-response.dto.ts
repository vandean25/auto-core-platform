import { ApiProperty } from '@nestjs/swagger';
import {
  WorkshopLineItemType,
  WorkshopPartLineExecutionStatus,
  WorkshopTaskStatus,
} from '@prisma/client';

export class WorkshopTaskLineItemResponseDto {
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
  laborOperationId?: string | null;

  @ApiProperty({ type: Number, required: false, nullable: true })
  standardAw?: number | null;

  @ApiProperty({ type: Number, required: false, nullable: true })
  actualHours?: number | null;

  @ApiProperty({ type: Number, required: false, nullable: true })
  internalCostRate?: number | null;
}

export class WorkshopTaskResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  lineItemsVersion!: number;

  @ApiProperty({ enum: WorkshopTaskStatus })
  status!: WorkshopTaskStatus;

  @ApiProperty({ type: String, required: false, nullable: true })
  mechanic_notes?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  mechanicNotes?: string | null;

  @ApiProperty()
  done!: boolean;

  @ApiProperty({ type: [WorkshopTaskLineItemResponseDto], required: false })
  line_items?: WorkshopTaskLineItemResponseDto[];

  @ApiProperty({ type: [WorkshopTaskLineItemResponseDto] })
  lineItems!: WorkshopTaskLineItemResponseDto[];

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
