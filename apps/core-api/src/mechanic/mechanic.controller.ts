import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { MechanicQueueResponseDto } from './dto/mechanic-queue-item.dto';
import { MechanicTaskDetailDto } from './dto/mechanic-task-detail.dto';
import { PauseTaskDto, SwitchTaskDto } from './dto/task-execution.dto';
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

  /**
   * Punch in: creates a LaborEntry and transitions the task to IN_PROGRESS.
   *
   * Returns 409 if the mechanic already has an open LaborEntry.
   * ADR-0014 §4.2
   */
  @Post('tasks/:taskId/start')
  @HttpCode(HttpStatus.OK)
  @ApiQuery({
    name: 'mechanicId',
    required: true,
    description: 'UUID of the mechanic (Employee with role MECHANIC)',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOperation({ summary: 'Start a task (punch in)' })
  @ApiOkResponse({ type: MechanicTaskDetailDto })
  async startTask(
    @Query('mechanicId', ParseUUIDPipe) mechanicId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ): Promise<MechanicTaskDetailDto> {
    await this.mechanicService.assertMechanicAccess(mechanicId);
    return this.mechanicService.startTask(mechanicId, taskId);
  }

  /**
   * Switch task: atomically closes the current open labor entry, transitions
   * the previous task, opens a new labor entry, and moves the target task
   * to IN_PROGRESS.
   *
   * Returns 409 if the mechanic has no open labor entry to switch from.
   * ADR-0014 §4.2.1
   */
  @Post('tasks/:taskId/switch')
  @HttpCode(HttpStatus.OK)
  @ApiQuery({
    name: 'mechanicId',
    required: true,
    description: 'UUID of the mechanic (Employee with role MECHANIC)',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOperation({ summary: 'Switch to a different task' })
  @ApiBody({ type: SwitchTaskDto })
  @ApiOkResponse({ type: MechanicTaskDetailDto })
  async switchTask(
    @Query('mechanicId', ParseUUIDPipe) mechanicId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: SwitchTaskDto,
  ): Promise<MechanicTaskDetailDto> {
    await this.mechanicService.assertMechanicAccess(mechanicId);
    return this.mechanicService.switchTask(mechanicId, taskId, dto);
  }

  /**
   * Pause: closes the active LaborEntry and transitions the task status
   * based on the supplied pause reason.
   *
   * Returns 409 if there is no open labor entry for this task.
   * ADR-0014 §4.3
   */
  @Post('tasks/:taskId/pause')
  @HttpCode(HttpStatus.OK)
  @ApiQuery({
    name: 'mechanicId',
    required: true,
    description: 'UUID of the mechanic (Employee with role MECHANIC)',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOperation({ summary: 'Pause the active task' })
  @ApiBody({ type: PauseTaskDto })
  @ApiOkResponse({ type: MechanicTaskDetailDto })
  async pauseTask(
    @Query('mechanicId', ParseUUIDPipe) mechanicId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: PauseTaskDto,
  ): Promise<MechanicTaskDetailDto> {
    await this.mechanicService.assertMechanicAccess(mechanicId);
    return this.mechanicService.pauseTask(mechanicId, taskId, dto);
  }

  /**
   * Complete task: closes any active LaborEntry, transitions the task to
   * DONE, and completes the parent order when all tasks are done.
   *
   * ADR-0014 §4.4
   */
  @Post('tasks/:taskId/complete')
  @HttpCode(HttpStatus.OK)
  @ApiQuery({
    name: 'mechanicId',
    required: true,
    description: 'UUID of the mechanic (Employee with role MECHANIC)',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOperation({ summary: 'Complete the task' })
  @ApiOkResponse({ type: MechanicTaskDetailDto })
  async completeTask(
    @Query('mechanicId', ParseUUIDPipe) mechanicId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ): Promise<MechanicTaskDetailDto> {
    await this.mechanicService.assertMechanicAccess(mechanicId);
    return this.mechanicService.completeTask(mechanicId, taskId);
  }
}
