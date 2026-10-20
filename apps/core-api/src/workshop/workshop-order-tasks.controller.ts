import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { DryRunSupported } from '../dry-run/dry-run.decorators.js';
import {
  AddWorkshopTaskLineFromCatalogDto,
  AddWorkshopTaskLineFromCatalogResponseDto,
  CreateWorkshopTaskDto,
  PickWorkshopPartsDto,
  PickWorkshopPartsResponseDto,
  ReplaceWorkshopTaskLineItemsDto,
  UpdateWorkshopInspectionDto,
  UpdateWorkshopTaskDto,
  WorkshopInspectionResponseDto,
  WorkshopTaskResponseDto,
} from './dto/index.js';
import * as line from './workshop-catalog-line.service.js';
import * as pick from './workshop-pick-parts.service.js';
import * as task from './workshop-task.service.js';
import { WorkshopInspectionService } from './workshop-inspection.service.js';
import {
  ApiWorkshopDeleteTaskResponses,
  ApiWorkshopOrderOkResponse,
} from './workshop-orders.openapi-decorators.js';

@ApiTags('Workshop')
@Controller('workshop')
export class WorkshopOrderTasksController {
  private readonly logger = new Logger(WorkshopOrderTasksController.name);

  constructor(
    private readonly catalogLineService: line.WorkshopCatalogLineService,
    private readonly inspectionService: WorkshopInspectionService,
    private readonly pickPartsService: pick.WorkshopPickPartsService,
    private readonly taskService: task.WorkshopTaskService,
  ) {}

  private logAction(action: string) {
    this.logger.debug(action);
  }

  @Post('orders/:id/tasks')
  @ApiOperation({ operationId: 'WorkshopOrdersController_createTask' })
  @ApiCreatedResponse({ type: WorkshopTaskResponseDto })
  createTask(@Param('id') id: string, @Body() dto: CreateWorkshopTaskDto) {
    this.logAction('createTask');
    return this.taskService.createTask(id, dto);
  }

  @Post('orders/:id/tasks/:taskId/lines/from-catalog')
  @ApiOperation({
    operationId: 'WorkshopOrdersController_addTaskLineFromCatalog',
  })
  @HttpCode(200)
  @ApiOkResponse({ type: AddWorkshopTaskLineFromCatalogResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid catalog hit token' })
  @ApiConflictResponse({ description: 'Catalog hit context conflict' })
  addTaskLineFromCatalog(
    @Param('id') orderId: string,
    @Param('taskId') taskId: string,
    @Body() dto: AddWorkshopTaskLineFromCatalogDto,
  ) {
    this.logAction('addTaskLineFromCatalog');
    return this.catalogLineService.addLineFromCatalog(orderId, taskId, dto);
  }

  @Post('orders/:id/pick-parts')
  @ApiOperation({ operationId: 'WorkshopOrdersController_pickParts' })
  @ApiCreatedResponse({
    description: 'Workshop parts pick transfer summary.',
    type: PickWorkshopPartsResponseDto,
  })
  pickParts(@Param('id') orderId: string, @Body() dto: PickWorkshopPartsDto) {
    this.logAction('pickParts');
    return this.pickPartsService.pickParts(orderId, dto);
  }

  @Patch('orders/:orderId/tasks/:taskId')
  @ApiOperation({ operationId: 'WorkshopOrdersController_updateTask' })
  @ApiWorkshopOrderOkResponse()
  updateTask(
    @Param('orderId') orderId: string,
    @Param('taskId') taskId: string,
    @Body() dto: UpdateWorkshopTaskDto,
  ) {
    this.logAction('updateTask');
    return this.taskService.updateTask(orderId, taskId, dto);
  }

  @Get('orders/:orderId/tasks/:taskId/checklist')
  @ApiOperation({ operationId: 'WorkshopOrdersController_getTaskChecklist' })
  @ApiOkResponse({
    description: 'Task inspection checklist.',
    type: WorkshopInspectionResponseDto,
  })
  getTaskChecklist(
    @Param('orderId') orderId: string,
    @Param('taskId') taskId: string,
  ) {
    this.logAction('getTaskChecklist');
    return this.inspectionService.getTaskChecklist(orderId, taskId);
  }

  @Patch('orders/:orderId/tasks/:taskId/checklist')
  @ApiOperation({ operationId: 'WorkshopOrdersController_updateTaskChecklist' })
  @ApiOkResponse({
    description: 'Updated task inspection checklist.',
    type: WorkshopInspectionResponseDto,
  })
  updateTaskChecklist(
    @Param('orderId') orderId: string,
    @Param('taskId') taskId: string,
    @Body() dto: UpdateWorkshopInspectionDto,
  ) {
    this.logAction('updateTaskChecklist');
    return this.inspectionService.updateTaskChecklist(orderId, taskId, dto);
  }

  @Delete('orders/:orderId/tasks/:taskId')
  @ApiOperation({ operationId: 'WorkshopOrdersController_deleteTask' })
  @ApiWorkshopDeleteTaskResponses()
  deleteTask(
    @Param('orderId') orderId: string,
    @Param('taskId') taskId: string,
  ) {
    this.logAction('deleteTask');
    return this.taskService.deleteTask(orderId, taskId);
  }

  @Patch('orders/:orderId/tasks/:taskId/line-items')
  @ApiOperation({
    operationId: 'WorkshopOrdersController_replaceTaskLineItems',
  })
  @DryRunSupported()
  @ApiWorkshopOrderOkResponse()
  replaceTaskLineItems(
    @Param('orderId') orderId: string,
    @Param('taskId') taskId: string,
    @Body() dto: ReplaceWorkshopTaskLineItemsDto,
  ) {
    this.logAction('replaceTaskLineItems');
    return this.taskService.replaceTaskLineItems(orderId, taskId, dto);
  }
}
