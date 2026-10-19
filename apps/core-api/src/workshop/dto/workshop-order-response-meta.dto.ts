import { ApiProperty } from '@nestjs/swagger';
import { WorkshopOrderPurpose, WorkshopOrderStatus } from '@prisma/client';
import { DryRunMetaDto } from '../../dry-run/dto/dry-run-response.dto.js';

export class WorkshopOrderResponseMetaDto extends DryRunMetaDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  order_number!: string;

  @ApiProperty({ enum: WorkshopOrderStatus })
  status!: WorkshopOrderStatus;

  @ApiProperty({ enum: WorkshopOrderPurpose })
  purpose!: WorkshopOrderPurpose;

  @ApiProperty({ type: String, required: false, nullable: true })
  customer_id?: string | null;

  @ApiProperty()
  vehicle_id!: string;

  @ApiProperty()
  odometer!: number;

  @ApiProperty()
  fuel_level!: number;

  @ApiProperty({ type: String, required: false, nullable: true })
  reported_issue?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  reportedIssue?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  notes?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  staging_location_id?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  stagingLocationId?: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiProperty({ type: String, required: false, nullable: true })
  bill_to_customer_id?: string | null;
}
