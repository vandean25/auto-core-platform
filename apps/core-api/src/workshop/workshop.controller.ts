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
import { CloudTasksWorkerGuard } from '../common/guards/cloud-tasks-worker.guard';
import { CreateWorkshopOrderDto } from './dto/create-workshop-order.dto';
import { CreateWorkshopTaskDto } from './dto/create-workshop-task.dto';
import { RegisterIntakeDto } from './dto/register-intake.dto';
import { ReplaceWorkshopTaskLineItemsDto } from './dto/replace-workshop-task-line-items.dto';
import { PickWorkshopPartsDto } from './dto/pick-workshop-parts.dto';
import { UpdateWorkshopOrderDto } from './dto/update-workshop-order.dto';
import { UpdateWorkshopTaskDto } from './dto/update-workshop-task.dto';
import { WorkshopPdfGenerationResponseDto } from './dto/workshop-pdf-generation-response.dto';
import { WorkshopPdfService } from './workshop-pdf.service';
import { WorkshopService } from './workshop.service';

@Controller('workshop')
export class WorkshopController {
  constructor(
    private readonly workshopService: WorkshopService,
    private readonly pdfService: WorkshopPdfService,
  ) {}

  @Post('register')
  register(@Body() dto: RegisterIntakeDto) {
    return this.workshopService.register(dto);
  }

  @Post('orders')
  create(@Body() createWorkshopOrderDto: CreateWorkshopOrderDto) {
    return this.workshopService.create(createWorkshopOrderDto);
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

    return this.workshopService.findAll({
      search,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      sortField,
      sortDirection,
    });
  }

  @Get('orders/:id')
  findOne(@Param('id') id: string) {
    return this.workshopService.findOne(id);
  }

  @Patch('orders/:id')
  updateOrder(@Param('id') id: string, @Body() dto: UpdateWorkshopOrderDto) {
    return this.workshopService.updateOrder(id, dto);
  }

  @Post('orders/:id/tasks')
  createTask(@Param('id') id: string, @Body() dto: CreateWorkshopTaskDto) {
    return this.workshopService.createTask(id, dto);
  }

  @Post(':id/pick-parts')
  pickParts(@Param('id') id: string, @Body() dto: PickWorkshopPartsDto) {
    return this.workshopService.pickParts(id, dto);
  }

  @Patch('orders/:orderId/tasks/:taskId')
  updateTask(
    @Param('orderId') orderId: string,
    @Param('taskId') taskId: string,
    @Body() dto: UpdateWorkshopTaskDto,
  ) {
    return this.workshopService.updateTask(orderId, taskId, dto);
  }

  @Delete('orders/:orderId/tasks/:taskId')
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
    return this.workshopService.deleteTask(orderId, taskId);
  }

  @Patch('orders/:orderId/tasks/:taskId/line-items')
  replaceTaskLineItems(
    @Param('orderId') orderId: string,
    @Param('taskId') taskId: string,
    @Body() dto: ReplaceWorkshopTaskLineItemsDto,
  ) {
    return this.workshopService.replaceTaskLineItems(orderId, taskId, dto);
  }

  @Post('orders/:id/create-invoice')
  createInvoiceFromOrder(@Param('id') id: string) {
    return this.workshopService.createInvoiceFromOrder(id);
  }

  @Get('search')
  search(@Query('q') q: string) {
    return this.workshopService.search(q);
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
  @Post('orders/:id/pdf/worker')
  @UseGuards(CloudTasksWorkerGuard)
  @HttpCode(204)
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
}
