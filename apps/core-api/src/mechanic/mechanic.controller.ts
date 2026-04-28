import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { MechanicQueueResponseDto } from './dto/mechanic-queue-item.dto';
import { MechanicTaskDetailDto } from './dto/mechanic-task-detail.dto';
import { MechanicService } from './mechanic.service';

@ApiTags('mechanic')
@Controller('mechanic')
export class MechanicController {
  constructor(private readonly mechanicService: MechanicService) {}

  /**
   * Returns the active task queue for the given mechanic.
   *
   * Only tasks assigned to the mechanic (directly or via order-level
   * inheritance — ADR-0014 §2.2) that are not DONE are returned.
   *
   * Requires TECH tenant-member role.
   */
  @Get('queue')
  @ApiQuery({
    name: 'mechanicId',
    required: true,
    description: 'UUID of the mechanic (Employee with role MECHANIC)',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ type: MechanicQueueResponseDto })
  async getQueue(
    @Query('mechanicId', ParseUUIDPipe) mechanicId: string,
  ): Promise<MechanicQueueResponseDto> {
    await this.mechanicService.assertMechanicAccess(mechanicId);
    const data = await this.mechanicService.getMechanicQueue(mechanicId);
    return { data };
  }

  /**
   * Returns the restricted task-detail projection for a single task.
   *
   * Access is denied when the task is not assigned to the mechanic.
   *
   * Requires TECH tenant-member role.
   */
  @Get('tasks/:taskId')
  @ApiQuery({
    name: 'mechanicId',
    required: true,
    description: 'UUID of the mechanic (Employee with role MECHANIC)',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ type: MechanicTaskDetailDto })
  async getTaskDetail(
    @Query('mechanicId', ParseUUIDPipe) mechanicId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ): Promise<MechanicTaskDetailDto> {
    await this.mechanicService.assertMechanicAccess(mechanicId);
    return this.mechanicService.getMechanicTaskDetail(mechanicId, taskId);
  }
}
