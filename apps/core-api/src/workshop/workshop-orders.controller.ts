import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiProduces,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiPaginatedResponse } from '../common/dto/paginated-response.dto.js';
import { PdfWorker } from '../common/index.js';
import { DryRunSupported } from '../dry-run/dry-run.decorators.js';
import { InvoiceResponseDto } from '../sales/dto/invoice-response.dto.js';
import {
  AddWorkshopTaskLineFromCatalogDto,
  AddWorkshopTaskLineFromCatalogResponseDto,
  CreateWorkshopOrderDto,
  CreateWorkshopTaskDto,
  FindAllWorkshopOrdersQueryDto,
  PickWorkshopPartsDto,
  PickWorkshopPartsResponseDto,
  ReplaceWorkshopTaskLineItemsDto,
  UpdateWorkshopInspectionDto,
  UpdateWorkshopOrderDto,
  UpdateWorkshopTaskDto,
  WorkshopInspectionResponseDto,
  WorkshopPdfGenerationResponseDto,
  WorkshopTaskResponseDto,
} from './dto/index.js';
import { WorkshopOrderResponseDto } from './dto/workshop-order-response.dto.js';
import * as intake from './workshop-intake.service.js';
import * as invoice from './workshop-invoice.service.js';
import * as line from './workshop-catalog-line.service.js';
import * as pdf from './workshop-pdf.service.js';
import * as pick from './workshop-pick-parts.service.js';
import * as task from './workshop-task.service.js';
import { WorkshopInspectionService } from './workshop-inspection.service.js';
import {
  ApiWorkshopPaginationQueries,
  enqueueWorkshopPdfGeneration,
  parsePaginationParams,
  serveWorkshopPdfDownload,
  WORKSHOP_ERROR_RESPONSE_SCHEMA,
} from './workshop-controller.http-helpers.js';

@ApiTags('Workshop')
@Controller('workshop')
export class WorkshopOrdersController {
  private readonly logger = new Logger(WorkshopOrdersController.name);

  @Inject(invoice.WorkshopInvoiceService)
  private readonly invoiceService!: invoice.WorkshopInvoiceService;

  constructor(
    private readonly catalogLineService: line.WorkshopCatalogLineService,
    private readonly intakeService: intake.WorkshopIntakeService,
    private readonly inspectionService: WorkshopInspectionService,
    private readonly pdfService: pdf.WorkshopPdfService,
    private readonly pickPartsService: pick.WorkshopPickPartsService,
    private readonly taskService: task.WorkshopTaskService,
  ) {}

  private logAction(action: string) {
    this.logger.debug(action);
  }

  @Post('orders')
  @DryRunSupported()
  @ApiCreatedResponse({ type: WorkshopOrderResponseDto })
  create(@Body() createWorkshopOrderDto: CreateWorkshopOrderDto) {
    this.logAction('create');
    return this.intakeService.create(createWorkshopOrderDto);
  }

  @Get('orders')
  @ApiWorkshopPaginationQueries()
  @ApiPaginatedResponse(WorkshopOrderResponseDto)
  findAll(@Query() query: FindAllWorkshopOrdersQueryDto) {
    this.logAction('findAll');
    const pagination = parsePaginationParams(query.page, query.pageSize);
    return this.intakeService.findAll({
      search: query.search,
      ...pagination,
      sortField: query.sortField,
      sortDirection: query.sortDirection,
      customerId: query.customerId,
    });
  }

  @Get('orders/:id')
  @ApiOkResponse({ type: WorkshopOrderResponseDto })
  findOne(@Param('id') id: string) {
    this.logAction('findOne');
    return this.intakeService.findOne(id);
  }

  @Patch('orders/:id')
  @ApiOkResponse({ type: WorkshopOrderResponseDto })
  updateOrder(@Param('id') id: string, @Body() dto: UpdateWorkshopOrderDto) {
    this.logAction('updateOrder');
    return this.intakeService.updateOrder(id, dto);
  }

  @Post('orders/:id/tasks')
  @ApiCreatedResponse({ type: WorkshopTaskResponseDto })
  createTask(@Param('id') id: string, @Body() dto: CreateWorkshopTaskDto) {
    this.logAction('createTask');
    return this.taskService.createTask(id, dto);
  }

  @Post('orders/:id/tasks/:taskId/lines/from-catalog')
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
  @ApiCreatedResponse({
    description: 'Workshop parts pick transfer summary.',
    type: PickWorkshopPartsResponseDto,
  })
  pickParts(@Param('id') orderId: string, @Body() dto: PickWorkshopPartsDto) {
    this.logAction('pickParts');
    return this.pickPartsService.pickParts(orderId, dto);
  }

  @Patch('orders/:orderId/tasks/:taskId')
  @ApiOkResponse({ type: WorkshopOrderResponseDto })
  updateTask(
    @Param('orderId') orderId: string,
    @Param('taskId') taskId: string,
    @Body() dto: UpdateWorkshopTaskDto,
  ) {
    this.logAction('updateTask');
    return this.taskService.updateTask(orderId, taskId, dto);
  }

  @Get('orders/:orderId/tasks/:taskId/checklist')
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
  @ApiOkResponse({ type: WorkshopOrderResponseDto })
  @ApiResponse({
    status: 200,
    description: 'Workshop task deleted successfully.',
  })
  @ApiResponse({
    status: 400,
    description:
      'Task cannot be deleted because the order is invoiced or already has a linked invoice.',
    schema: WORKSHOP_ERROR_RESPONSE_SCHEMA,
  })
  @ApiResponse({
    status: 404,
    description: 'Workshop task or order was not found.',
    schema: WORKSHOP_ERROR_RESPONSE_SCHEMA,
  })
  deleteTask(
    @Param('orderId') orderId: string,
    @Param('taskId') taskId: string,
  ) {
    this.logAction('deleteTask');
    return this.taskService.deleteTask(orderId, taskId);
  }

  @Patch('orders/:orderId/tasks/:taskId/line-items')
  @DryRunSupported()
  @ApiOkResponse({ type: WorkshopOrderResponseDto })
  replaceTaskLineItems(
    @Param('orderId') orderId: string,
    @Param('taskId') taskId: string,
    @Body() dto: ReplaceWorkshopTaskLineItemsDto,
  ) {
    this.logAction('replaceTaskLineItems');
    return this.taskService.replaceTaskLineItems(orderId, taskId, dto);
  }

  @Post('orders/:id/create-invoice')
  @ApiCreatedResponse({ type: InvoiceResponseDto })
  createInvoiceFromOrder(@Param('id') id: string) {
    this.logAction('createInvoiceFromOrder');
    return this.invoiceService.createInvoiceFromOrder(id);
  }

  @Post('orders/:id/pdf')
  @ApiCreatedResponse({
    description: 'Workshop PDF generation status.',
    type: WorkshopPdfGenerationResponseDto,
  })
  async generatePdf(@Param('id', ParseUUIDPipe) id: string) {
    this.logAction('generatePdf');
    return enqueueWorkshopPdfGeneration(this.pdfService, id);
  }

  @Post('orders/:id/pdf/worker')
  @PdfWorker('workshop-order')
  async generatePdfWorker(@Param('id', ParseUUIDPipe) id: string) {
    this.logAction('generatePdfWorker');
    await this.pdfService.generateNow(id);
  }

  @Get('orders/:id/pdf')
  @ApiProduces('application/pdf')
  @ApiOkResponse({
    description: 'Workshop PDF',
    schema: {
      type: 'string',
      format: 'binary',
    },
  })
  async getPdf(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    this.logAction('getPdf');
    await serveWorkshopPdfDownload(this.pdfService, id, res);
  }
}
