import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { WorkshopResumeWaitingTasksResponseDto } from './dto/workshop-waiting-tasks.dto.js';
import { WorkshopWaitingTasksService } from './workshop-waiting-tasks.service.js';

@ApiTags('Workshop')
@Controller('workshop')
export class WorkshopWaitingTasksController {
  constructor(private readonly waitingTasks: WorkshopWaitingTasksService) {}

  /** Advisor action "Resume waiting tasks" (AUT-355, ADR-0025 §9). Approval does not resume tasks by itself. */
  @Post('orders/:id/tasks/resume-waiting')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: WorkshopResumeWaitingTasksResponseDto })
  resumeWaitingTasks(@Param('id', ParseUUIDPipe) id: string) {
    return this.waitingTasks.resumeWaitingTasks(id);
  }
}
