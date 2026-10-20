import { ApiProperty } from '@nestjs/swagger';
import { WorkshopOrderResponseCoreDto } from './workshop-order-response.core.dto.js';

export * from './workshop-order-loaner-booking-summary.dto.js';
export * from './workshop-order-summaries.dto.js';
export * from './workshop-task-response.dto.js';

export class WorkshopOrderResponseDto extends WorkshopOrderResponseCoreDto {
  @ApiProperty({ type: String, required: false, nullable: true })
  bill_to_customer_id?: string | null;
}
