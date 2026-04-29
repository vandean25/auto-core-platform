import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { MechanicQueueResponseDto } from './dto/mechanic-queue-item.dto';
import { MechanicTaskDetailDto } from './dto/mechanic-task-detail.dto';
import { PauseTaskDto, SwitchTaskDto } from './dto/task-execution.dto';
import {
  SaveDiagnosticsDto,
  SaveDiagnosticsResponseDto,
} from './dto/save-diagnostics.dto';
import { RequestPartDto, RequestPartResponseDto } from './dto/request-part.dto';
import {
  CreateMediaDto,
  MediaUploadPolicyDto,
  RequestMediaUploadDto,
  WorkshopMediaDto,
} from './dto/media.dto';
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

  /**
   * Debounced auto-save for mechanic notes and inspection checklist values.
   *
   * All payload fields are optional; the client sends whatever changed since
   * the last debounce interval (ADR-0014 §5.1, ADR-0006).
   */
  @Patch('tasks/:taskId/diagnostics')
  @HttpCode(HttpStatus.OK)
  @ApiQuery({
    name: 'mechanicId',
    required: true,
    description: 'UUID of the mechanic (Employee with role MECHANIC)',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOperation({
    summary: 'Debounced auto-save of mechanic notes and checklist values',
  })
  @ApiBody({ type: SaveDiagnosticsDto })
  @ApiOkResponse({ type: SaveDiagnosticsResponseDto })
  async saveDiagnostics(
    @Query('mechanicId', ParseUUIDPipe) mechanicId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: SaveDiagnosticsDto,
  ): Promise<SaveDiagnosticsResponseDto> {
    await this.mechanicService.assertMechanicAccess(mechanicId);
    return this.mechanicService.saveDiagnostics(mechanicId, taskId, dto);
  }

  /**
   * Add a part request to the task.
   *
   * Creates a new `WorkshopTaskLineItem` (type=PART) with
   * `part_execution_status=PENDING_PICK`.  Stock is NOT deducted.
   * ADR-0014 §6.1
   */
  @Post('tasks/:taskId/parts')
  @HttpCode(HttpStatus.CREATED)
  @ApiQuery({
    name: 'mechanicId',
    required: true,
    description: 'UUID of the mechanic (Employee with role MECHANIC)',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOperation({
    summary: 'Request a part (marks PENDING_PICK, no stock deduction)',
  })
  @ApiBody({ type: RequestPartDto })
  @ApiCreatedResponse({ type: RequestPartResponseDto })
  async requestPart(
    @Query('mechanicId', ParseUUIDPipe) mechanicId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: RequestPartDto,
  ): Promise<RequestPartResponseDto> {
    await this.mechanicService.assertMechanicAccess(mechanicId);
    return this.mechanicService.requestPart(mechanicId, taskId, dto);
  }

  /**
   * Create a presigned POST upload policy for direct-to-storage file upload.
   *
   * The client uses the returned policy to upload the file directly to cloud
   * storage without routing the binary through the backend.
   * After upload, the client must call `POST /media` to persist metadata.
   * ADR-0014 §7.1
   */
  @Post('tasks/:taskId/media/uploads')
  @HttpCode(HttpStatus.CREATED)
  @ApiQuery({
    name: 'mechanicId',
    required: true,
    description: 'UUID of the mechanic (Employee with role MECHANIC)',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOperation({
    summary:
      'Generate presigned POST upload policy for direct-to-storage upload',
  })
  @ApiBody({ type: RequestMediaUploadDto })
  @ApiCreatedResponse({ type: MediaUploadPolicyDto })
  async createMediaUploadPolicy(
    @Query('mechanicId', ParseUUIDPipe) mechanicId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: RequestMediaUploadDto,
  ): Promise<MediaUploadPolicyDto> {
    await this.mechanicService.assertMechanicAccess(mechanicId);
    return this.mechanicService.createMediaUploadPolicy(
      mechanicId,
      taskId,
      dto,
    );
  }

  /**
   * Persist media metadata after a successful direct upload.
   *
   * Media metadata is stored only after the upload completes successfully.
   * File blobs are never written to Postgres (ADR-0014 §7.2).
   */
  @Post('tasks/:taskId/media')
  @HttpCode(HttpStatus.CREATED)
  @ApiQuery({
    name: 'mechanicId',
    required: true,
    description: 'UUID of the mechanic (Employee with role MECHANIC)',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOperation({ summary: 'Persist uploaded media metadata' })
  @ApiBody({ type: CreateMediaDto })
  @ApiCreatedResponse({ type: WorkshopMediaDto })
  async saveMediaMetadata(
    @Query('mechanicId', ParseUUIDPipe) mechanicId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: CreateMediaDto,
  ): Promise<WorkshopMediaDto> {
    await this.mechanicService.assertMechanicAccess(mechanicId);
    return this.mechanicService.saveMediaMetadata(mechanicId, taskId, dto);
  }
}
