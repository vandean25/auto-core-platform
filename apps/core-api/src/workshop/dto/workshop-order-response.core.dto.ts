import { ApiProperty } from '@nestjs/swagger';
import { WorkshopOrderPurpose, WorkshopOrderStatus } from '@prisma/client';
import { DryRunMetaDto } from '../../dry-run/dto/dry-run-response.dto.js';
import { WorkshopReadyEmailNoticeDto } from './workshop-ready-email-notice.dto.js';
import { WorkshopOrderLoanerBookingSummaryDto } from './workshop-order-loaner-booking-summary.dto.js';
import {
  WorkshopCustomerSummaryDto,
  WorkshopInvoiceSummaryDto,
  WorkshopVehicleSummaryDto,
} from './workshop-order-summaries.dto.js';
import { WorkshopTaskResponseDto } from './workshop-task-response.dto.js';

export class WorkshopOrderResponseCoreDto extends DryRunMetaDto {
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

  @ApiProperty({
    type: () => WorkshopCustomerSummaryDto,
    required: false,
    nullable: true,
  })
  customer?: WorkshopCustomerSummaryDto | null;

  @ApiProperty({ type: () => WorkshopVehicleSummaryDto })
  vehicle!: WorkshopVehicleSummaryDto;

  @ApiProperty({ type: [WorkshopTaskResponseDto] })
  tasks!: WorkshopTaskResponseDto[];

  @ApiProperty({ required: false, type: () => WorkshopInvoiceSummaryDto })
  invoice?: WorkshopInvoiceSummaryDto | null;

  @ApiProperty({
    required: false,
    nullable: true,
    type: () => WorkshopOrderLoanerBookingSummaryDto,
  })
  loanerBooking?: WorkshopOrderLoanerBookingSummaryDto | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiProperty({
    type: () => WorkshopReadyEmailNoticeDto,
    required: false,
    nullable: true,
    description:
      'Ready-for-pickup email state when the order is COMPLETED (AUT-357). Null while the job is still open.',
  })
  ready_email_notice?: WorkshopReadyEmailNoticeDto | null;
}
