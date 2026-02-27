import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { WorkshopService } from './workshop.service';
import { CreateWorkshopOrderDto } from './dto/create-workshop-order.dto';
import { RegisterIntakeDto } from './dto/register-intake.dto';
import { UpdateWorkshopOrderDto } from './dto/update-workshop-order.dto';
import { CreateWorkshopTaskDto } from './dto/create-workshop-task.dto';
import { UpdateWorkshopTaskDto } from './dto/update-workshop-task.dto';
import { ReplaceWorkshopTaskLineItemsDto } from './dto/replace-workshop-task-line-items.dto';

@Controller('workshop')
export class WorkshopController {
  constructor(private readonly workshopService: WorkshopService) {}

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
  @ApiQuery({ name: 'page', required: false, schema: { type: 'integer', minimum: 1 } })
  @ApiQuery({ name: 'pageSize', required: false, schema: { type: 'integer', minimum: 1 } })
  @ApiQuery({ name: 'sortField', required: false, schema: { type: 'string' } })
  @ApiQuery({ name: 'sortDirection', required: false, schema: { type: 'string', enum: ['asc', 'desc'] } })
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

  @Patch('orders/:orderId/tasks/:taskId')
  updateTask(
    @Param('orderId') orderId: string,
    @Param('taskId') taskId: string,
    @Body() dto: UpdateWorkshopTaskDto,
  ) {
    return this.workshopService.updateTask(orderId, taskId, dto);
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
}
