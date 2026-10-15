import { ApiProperty } from '@nestjs/swagger';

/** Tasks the advisor resumed from WAITING_CUSTOMER. Empty when none was waiting. */
export class WorkshopResumeWaitingTasksResponseDto {
  @ApiProperty({ type: [String] })
  resumed_task_ids!: string[];
}
