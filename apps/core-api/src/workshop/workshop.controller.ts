import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { WorkshopService } from './workshop.service';
import { CreateWorkshopOrderDto } from './dto/create-workshop-order.dto';
import { RegisterIntakeDto } from './dto/register-intake.dto';

@Controller('api/workshop')
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

  @Get('search')
  search(@Query('q') q: string) {
    return this.workshopService.search(q);
  }
}
