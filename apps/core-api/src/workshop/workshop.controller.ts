import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiProduces,
  ApiQuery,
  ApiResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { ApiPaginatedResponse } from '../common/dto/paginated-response.dto.js';
import { PdfWorker } from '../common/index.js';
import { CreateWorkshopOrderDto } from './dto/create-workshop-order.dto.js';
import { CreateWorkshopTaskDto } from './dto/create-workshop-task.dto.js';
import { AddWorkshopTaskLineFromCatalogDto } from './dto/add-workshop-task-line-from-catalog.dto.js';
import { RegisterIntakeDto } from './dto/register-intake.dto.js';
import { ReplaceWorkshopTaskLineItemsDto } from './dto/replace-workshop-task-line-items.dto.js';
import { PickWorkshopPartsDto } from './dto/pick-workshop-parts.dto.js';
import { PickWorkshopPartsResponseDto } from './dto/pick-workshop-parts-response.dto.js';
import { UpdateWorkshopOrderDto } from './dto/update-workshop-order.dto.js';
import { UpdateWorkshopTaskDto } from './dto/update-workshop-task.dto.js';
import { WorkshopPdfGenerationResponseDto } from './dto/workshop-pdf-generation-response.dto.js';
import {
  WorkshopOrderResponseDto,
  WorkshopTaskResponseDto,
} from './dto/workshop-response.dto.js';
import { AddWorkshopTaskLineFromCatalogResponseDto } from './dto/workshop-catalog-line-response.dto.js';
import { WorkshopSearchResponseDto } from './dto/workshop-search-response.dto.js';
import { InvoiceResponseDto } from '../sales/dto/invoice-response.dto.js';
import { VehicleListItemDto } from '../vehicle/dto/vehicle-response.dto.js';
import { AssignBoardDto } from './dto/assign-board.dto.js';
import {
  BoardActiveResponseDto,
  WorkshopResourcesResponseDto,
} from './dto/board-response.dto.js';
import {
  CreateWorkshopHolidayDto,
  ImportWorkshopHolidaysDto,
  ImportWorkshopHolidaysResponseDto,
  ListWorkshopHolidaysQueryDto,
  UpdateWorkshopHolidayDto,
  WorkshopHolidayDto,
  WorkshopHolidayListResponseDto,
} from './dto/workshop-holiday.dto.js';
import {
  PlannerGridResponseDto,
  PlannerQueryDto,
} from './dto/workshop-planner.dto.js';
import {
  UpdateWorkshopSettingsDto,
  WorkshopSettingsResponseDto,
} from './dto/workshop-settings.dto.js';
import { WorkshopHolidayService } from './workshop-holiday.service.js';
import { WorkshopPlannerService } from './workshop-planner.service.js';
import { WorkshopBoardService } from './workshop-board.service.js';
import { WorkshopIntakeService } from './workshop-intake.service.js';
import { WorkshopInvoiceService } from './workshop-invoice.service.js';
import { WorkshopPdfService } from './workshop-pdf.service.js';
import { WorkshopPickPartsService } from './workshop-pick-parts.service.js';
import { WorkshopSettingsService } from './workshop-settings.service.js';
import { WorkshopTaskService } from './workshop-task.service.js';
import { WorkshopCatalogLineService } from './workshop-catalog-line.service.js';

@Controller('workshop')
export class WorkshopController {
  constructor(
    private readonly intakeService: WorkshopIntakeService,
    private readonly taskService: WorkshopTaskService,
    private readonly pickPartsService: WorkshopPickPartsService,
    private readonly boardService: WorkshopBoardService,
    private readonly invoiceService: WorkshopInvoiceService,
    private readonly pdfService: WorkshopPdfService,
    private readonly settingsService: WorkshopSettingsService,
    private readonly holidayService: WorkshopHolidayService,
    private readonly plannerService: WorkshopPlannerService,
    private readonly catalogLineService: WorkshopCatalogLineService,
  ) {}

  @Get('settings')
  @ApiOkResponse({ type: WorkshopSettingsResponseDto })
  getSettings() {
    return this.settingsService.getSettings();
  }

  @Put('settings')
  @ApiOkResponse({ type: WorkshopSettingsResponseDto })
  updateSettings(@Body() dto: UpdateWorkshopSettingsDto) {
    return this.settingsService.updateSettings(dto);
  }

  @Get('holidays')
  @ApiOkResponse({ type: WorkshopHolidayListResponseDto })
  listHolidays(@Query() query: ListWorkshopHolidaysQueryDto) {
    return this.holidayService.listHolidays(query.from, query.to);
  }

  @Post('holidays')
  @ApiCreatedResponse({ type: WorkshopHolidayDto })
  createHoliday(@Body() dto: CreateWorkshopHolidayDto) {
    return this.holidayService.createHoliday(dto);
  }

  @Post('holidays/import')
  @ApiOkResponse({ type: ImportWorkshopHolidaysResponseDto })
  importHolidays(@Body() dto: ImportWorkshopHolidaysDto) {
    return this.holidayService.importPublicHolidays(dto);
  }

  @Patch('holidays/:id')
  @ApiOkResponse({ type: WorkshopHolidayDto })
  updateHoliday(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkshopHolidayDto,
  ) {
    return this.holidayService.updateHoliday(id, dto);
  }

  @Delete('holidays/:id')
  @HttpCode(204)
  @ApiNoContentResponse()
  deleteHoliday(@Param('id', ParseUUIDPipe) id: string) {
    return this.holidayService.deleteHoliday(id);
  }

  @Get('planner')
  @ApiOkResponse({ type: PlannerGridResponseDto })
  getPlanner(@Query() query: PlannerQueryDto) {
    return this.plannerService.getPlanner(query);
  }

  @Post('register')
  @ApiCreatedResponse({ type: VehicleListItemDto })
  register(@Body() dto: RegisterIntakeDto) {
    return this.intakeService.register(dto);
  }

  @Post('orders')
  @ApiCreatedResponse({ type: WorkshopOrderResponseDto })
  create(@Body() createWorkshopOrderDto: CreateWorkshopOrderDto) {
    return this.intakeService.create(createWorkshopOrderDto);
  }

  @Get('orders')
  @ApiQuery({ name: 'search', required: false, schema: { type: 'string' } })
  @ApiQuery({
    name: 'page',
    required: false,
    schema: { type: 'integer', minimum: 1 },
  })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    schema: { type: 'integer', minimum: 1 },
  })
  @ApiQuery({ name: 'sortField', required: false, schema: { type: 'string' } })
  @ApiQuery({
    name: 'sortDirection',
    required: false,
    schema: { type: 'string', enum: ['asc', 'desc'] },
  })
  @ApiPaginatedResponse(WorkshopOrderResponseDto)
  findAll(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sortField') sortField?: string,
    @Query('sortDirection') sortDirection?: 'asc' | 'desc',
  ) {
    const integerPattern = /^\d+$/;
    const isInvalidPage =
      page !== undefined &&
      (!integerPattern.test(page) || parseInt(page, 10) <= 0);
    const isInvalidPageSize =
      pageSize !== undefined &&
      (!integerPattern.test(pageSize) || parseInt(pageSize, 10) <= 0);

    if (isInvalidPage || isInvalidPageSize) {
      throw new BadRequestException(
        'page and pageSize must be positive integers',
      );
    }

    return this.intakeService.findAll({
      search,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      sortField,
      sortDirection,
    });
  }

  @Get('orders/:id')
  @ApiOkResponse({ type: WorkshopOrderResponseDto })
  findOne(@Param('id') id: string) {
    return this.intakeService.findOne(id);
  }

  @Patch('orders/:id')
  @ApiOkResponse({ type: WorkshopOrderResponseDto })
  updateOrder(@Param('id') id: string, @Body() dto: UpdateWorkshopOrderDto) {
    return this.intakeService.updateOrder(id, dto);
  }

  @Post('orders/:id/tasks')
  @ApiCreatedResponse({ type: WorkshopTaskResponseDto })
  createTask(@Param('id') id: string, @Body() dto: CreateWorkshopTaskDto) {
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
    return this.catalogLineService.addLineFromCatalog(orderId, taskId, dto);
  }

  @Post('orders/:id/pick-parts')
  @ApiCreatedResponse({
    description: 'Workshop parts pick transfer summary.',
    type: PickWorkshopPartsResponseDto,
  })
  pickParts(@Param('id') orderId: string, @Body() dto: PickWorkshopPartsDto) {
    return this.pickPartsService.pickParts(orderId, dto);
  }

  @Patch('orders/:orderId/tasks/:taskId')
  @ApiOkResponse({ type: WorkshopOrderResponseDto })
  updateTask(
    @Param('orderId') orderId: string,
    @Param('taskId') taskId: string,
    @Body() dto: UpdateWorkshopTaskDto,
  ) {
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
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        code: { type: 'string' },
        statusCode: { type: 'number', example: 400 },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Workshop task or order was not found.',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        code: { type: 'string' },
        statusCode: { type: 'number', example: 404 },
      },
    },
  })
  deleteTask(
    @Param('orderId') orderId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.taskService.deleteTask(orderId, taskId);
  }

  @Patch('orders/:orderId/tasks/:taskId/line-items')
  @ApiOkResponse({ type: WorkshopOrderResponseDto })
  replaceTaskLineItems(
    @Param('orderId') orderId: string,
    @Param('taskId') taskId: string,
    @Body() dto: ReplaceWorkshopTaskLineItemsDto,
  ) {
    return this.taskService.replaceTaskLineItems(orderId, taskId, dto);
  }

  @Post('orders/:id/create-invoice')
  @ApiCreatedResponse({ type: InvoiceResponseDto })
  createInvoiceFromOrder(@Param('id') id: string) {
    return this.invoiceService.createInvoiceFromOrder(id);
  }

  @Get('search')
  @ApiOkResponse({ type: WorkshopSearchResponseDto })
  search(@Query('q') q: string) {
    return this.intakeService.search(q);
  }

  @Post('orders/:id/pdf')
  @ApiCreatedResponse({
    description: 'Workshop PDF generation status.',
    type: WorkshopPdfGenerationResponseDto,
  })
  async generatePdf(@Param('id', ParseUUIDPipe) id: string) {
    const targetBaseUrl = process.env.CLOUD_TASKS_TARGET_BASE_URL ?? '';

    const result = await this.pdfService.requestGeneration(id, {
      targetBaseUrl,
    });

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

  @Post('orders/:id/pdf/worker')
  @PdfWorker('workshop-order')
  async generatePdfWorker(@Param('id', ParseUUIDPipe) id: string) {
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
    const { stream, filename, contentType, contentLength } =
      await this.pdfService.getPdf(id);

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

  // ─── Board Endpoints ───────────────────────────────────────────────────────

  @Get('resources')
  @ApiOkResponse({ type: WorkshopResourcesResponseDto })
  getBoardResources() {
    return this.boardService.getBoardResources();
  }

  @Get('board/active')
  @ApiOkResponse({ type: BoardActiveResponseDto })
  getBoardActive() {
    return this.boardService.getBoardActive();
  }

  @Patch('board/assign')
  @ApiOkResponse({ description: 'Updated workshop order assignment.' })
  assignBoard(@Body() dto: AssignBoardDto) {
    return this.boardService.assignBoard(dto);
  }
}
