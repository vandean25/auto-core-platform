import { ApiProperty } from '@nestjs/swagger';
import { WorkshopReadyEmailNoticeDto } from './workshop-ready-email-notice.dto.js';
import {
  WorkshopCustomerSummaryDto,
  WorkshopInvoiceSummaryDto,
  WorkshopOrderLoanerBookingSummaryDto,
  WorkshopTaskResponseDto,
  WorkshopVehicleSummaryDto,
} from './workshop-response.dto.js';

export class WorkshopOrderResponseRelationsDto {
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

  @ApiProperty({
    type: () => WorkshopReadyEmailNoticeDto,
    required: false,
    nullable: true,
    description:
      'Ready-for-pickup email state when the order is COMPLETED (AUT-357). Null while the job is still open.',
  })
  ready_email_notice?: WorkshopReadyEmailNoticeDto | null;
}
