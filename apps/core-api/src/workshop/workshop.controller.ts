import {
  applyDecorators,
  BadRequestException,
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
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { ApiPaginatedResponse } from '../common/dto/paginated-response.dto.js';
import { PdfWorker } from '../common/index.js';
import {
  AddWorkshopTaskLineFromCatalogDto,
  AddWorkshopTaskLineFromCatalogResponseDto,
  AssignBoardDto,
  BoardActiveResponseDto,
  CreateWorkshopOrderDto,
  CreateWorkshopTaskDto,
  FindAllWorkshopOrdersQueryDto,
  PickWorkshopPartsDto,
  PickWorkshopPartsResponseDto,
  RegisterIntakeDto,
  ReplaceWorkshopTaskLineItemsDto,
  UpdateWorkshopOrderDto,
  UpdateWorkshopTaskDto,
  WorkshopOrderResponseDto,
  WorkshopPdfGenerationResponseDto,
  WorkshopResourcesResponseDto,
  WorkshopSearchResponseDto,
  WorkshopTaskResponseDto,
} from './dto/index.js';
import { InvoiceResponseDto } from '../sales/dto/invoice-response.dto.js';
import { VehicleListItemDto } from '../vehicle/dto/vehicle-response.dto.js';
import * as board from './workshop-board.service.js';
import * as line from './workshop-catalog-line.service.js';
import * as intake from './workshop-intake.service.js';
import * as invoice from './workshop-invoice.service.js';
import * as pdf from './workshop-pdf.service.js';
import * as pick from './workshop-pick-parts.service.js';
import * as task from './workshop-task.service.js';
import { DryRunSupported } from '../dry-run/dry-run.decorators.js';

function parsePositiveInteger(value?: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!/^\d+$/.test(value) || parseInt(value, 10) <= 0) {
    throw new BadRequestException(
      'page and pageSize must be positive integers',
    );
  }
  return parseInt(value, 10);
}

export function parsePaginationParams(
  page?: string,
  pageSize?: string,
): { page?: number; pageSize?: number } {
  return {
    page: parsePositiveInteger(page),
    pageSize: parsePositiveInteger(pageSize),
  };
}

export function ApiWorkshopPaginationQueries() {
  return applyDecorators(
    ApiQuery({ name: 'search', required: false, schema: { type: 'string' } }),
    ApiQuery({
      name: 'page',
      required: false,
      schema: { type: 'integer', minimum: 1 },
    }),
    ApiQuery({
      name: 'pageSize',
      required: false,
      schema: { type: 'integer', minimum: 1 },
    }),
    ApiQuery({
      name: 'sortField',
      required: false,
      schema: { type: 'string' },
    }),
    ApiQuery({
      name: 'sortDirection',
      required: false,
      schema: { type: 'string', enum: ['asc', 'desc'] },
    }),
  );
}

const ERROR_SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    code: { type: 'string' },
    statusCode: { type: 'number' },
  },
} as const;

async function enqueuePdfGeneration(
  pdfService: pdf.WorkshopPdfService,
  orderId: string,
) {
  const targetBaseUrl = process.env.CLOUD_TASKS_TARGET_BASE_URL ?? '';
  const result = await pdfService.requestGeneration(orderId, { targetBaseUrl });
  if (result.mode === 'enqueued') {
    return {
      message: 'PDF generation enqueued',
      enqueued: true,
      taskId: result.taskId,
    };
  }
  return {
    message: 'PDF is ready',
    enqueued: false,
  };
}

async function servePdfDownload(
  pdfService: pdf.WorkshopPdfService,
  orderId: string,
  res: Response,
) {
  const { stream, filename, contentType, contentLength } =
    await pdfService.getPdf(orderId);
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  res.set({
    'Content-Type': contentType,
    'Content-Disposition': `inline; filename="${safeFilename}"`,
  });
  if (contentLength != null) {
    res.set('Content-Length', contentLength.toString());
  }
  await pipeline(stream, res);
}

@ApiTags('Workshop')
@Controller('workshop')
export class WorkshopController {
  private readonly logger = new Logger(WorkshopController.name);

  @Inject(invoice.WorkshopInvoiceService)
  private readonly invoiceService!: invoice.WorkshopInvoiceService;

  constructor(
    private readonly boardService: board.WorkshopBoardService,
    private readonly catalogLineService: line.WorkshopCatalogLineService,
    private readonly pdfService: pdf.WorkshopPdfService,
    private readonly taskService: task.WorkshopTaskService,
    private readonly pickPartsService: pick.WorkshopPickPartsService,
    private readonly intakeService: intake.WorkshopIntakeService,
  ) {
    this.logAction('initialized');
  }

  private logAction(action: string) {
    this.logger.debug(action);
  }

  @Post('register')
  @ApiCreatedResponse({ type: VehicleListItemDto })
  register(@Body() dto: RegisterIntakeDto) {
    this.logAction('register');
    return this.intakeService.register(dto);
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
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 404,
    description: 'Workshop task or order was not found.',
    schema: ERROR_SCHEMA,
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

  @Get('search')
  @ApiOkResponse({ type: WorkshopSearchResponseDto })
  search(@Query('q') q: string) {
    this.logAction('search');
    return this.intakeService.search(q);
  }

  @Post('orders/:id/pdf')
  @ApiCreatedResponse({
    description: 'Workshop PDF generation status.',
    type: WorkshopPdfGenerationResponseDto,
  })
  async generatePdf(@Param('id', ParseUUIDPipe) id: string) {
    this.logAction('generatePdf');
    return enqueuePdfGeneration(this.pdfService, id);
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
    await servePdfDownload(this.pdfService, id, res);
  }

  // ─── Board Endpoints ───────────────────────────────────────────────────────

  @Get('resources')
  @ApiOkResponse({ type: WorkshopResourcesResponseDto })
  getBoardResources() {
    this.logAction('getBoardResources');
    return this.boardService.getBoardResources();
  }

  @Get('board/active')
  @ApiOkResponse({ type: BoardActiveResponseDto })
  getBoardActive() {
    this.logAction('getBoardActive');
    return this.boardService.getBoardActive();
  }

  @Patch('board/assign')
  @ApiOkResponse({ description: 'Updated workshop order assignment.' })
  assignBoard(@Body() dto: AssignBoardDto) {
    this.logAction('assignBoard');
    return this.boardService.assignBoard(dto);
  }
}
