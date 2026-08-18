import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiProduces,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { ApiPaginatedResponse } from '../common/dto/paginated-response.dto';
import { CloudTasksWorkerGuard } from '../common/guards/cloud-tasks-worker.guard';
import { CreateWorkshopOrderDto } from './dto/create-workshop-order.dto';
import { CreateWorkshopTaskDto } from './dto/create-workshop-task.dto';
import { RegisterIntakeDto } from './dto/register-intake.dto';
import { ReplaceWorkshopTaskLineItemsDto } from './dto/replace-workshop-task-line-items.dto';
import { PickWorkshopPartsDto } from './dto/pick-workshop-parts.dto';
import { PickWorkshopPartsResponseDto } from './dto/pick-workshop-parts-response.dto';
import { UpdateWorkshopOrderDto } from './dto/update-workshop-order.dto';
import { UpdateWorkshopTaskDto } from './dto/update-workshop-task.dto';
import { WorkshopPdfGenerationResponseDto } from './dto/workshop-pdf-generation-response.dto';
import {
  WorkshopOrderResponseDto,
  WorkshopTaskResponseDto,
} from './dto/workshop-response.dto';
import { AssignBoardDto } from './dto/assign-board.dto';
import {
  BoardActiveResponseDto,
  WorkshopResourcesResponseDto,
} from './dto/board-response.dto';
import { Public } from '../common/decorators/public.decorator';
import { TenantContextService } from '../common/services/tenant-context.service';
import { WorkshopBoardService } from './workshop-board.service';
import { WorkshopIntakeService } from './workshop-intake.service';
import { WorkshopInvoiceService } from './workshop-invoice.service';
import { WorkshopPdfService } from './workshop-pdf.service';
import { WorkshopPickPartsService } from './workshop-pick-parts.service';
import { WorkshopTaskService } from './workshop-task.service';

@Controller('workshop')
export class WorkshopController {
  constructor(
    private readonly intakeService: WorkshopIntakeService,
    private readonly taskService: WorkshopTaskService,
    private readonly pickPartsService: WorkshopPickPartsService,
    private readonly boardService: WorkshopBoardService,
    private readonly invoiceService: WorkshopInvoiceService,
    private readonly pdfService: WorkshopPdfService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post('register')
  @ApiCreatedResponse({
    schema: { type: 'object' },
  })
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
  @ApiCreatedResponse({
    schema: { type: 'object' },
  })
  createInvoiceFromOrder(@Param('id') id: string) {
    return this.invoiceService.createInvoiceFromOrder(id);
  }

  @Get('search')
  @ApiOkResponse({
    schema: { type: 'object' },
  })
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

  @ApiExcludeEndpoint()
  @Public()
  @Post('orders/:id/pdf/worker')
  @UseGuards(CloudTasksWorkerGuard)
  @HttpCode(204)
  async generatePdfWorker(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-tenant-id') tenantHeader: string,
  ) {
    if (!tenantHeader) {
      throw new BadRequestException('x-tenant-id header is required');
    }
    this.tenantContext.setTenantIdForWorker(tenantHeader);
    await this.pdfService.generateNow(id, tenantHeader);
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
