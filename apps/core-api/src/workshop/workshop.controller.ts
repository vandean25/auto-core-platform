import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { WorkshopService } from './workshop.service';
import { CreateWorkshopOrderDto } from './dto/create-workshop-order.dto';
import { RegisterIntakeDto } from './dto/register-intake.dto';
import { QueryParams } from '../common/utils/query-builder';

@Controller('workshop')
export class WorkshopController {
  constructor(private readonly workshopService: WorkshopService) { }

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

  @Get()
  findAll(@Query('params') params?: string) {
    let queryParams: QueryParams = {};
    if (params) {
      try {
        const parsed = JSON.parse(params);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new BadRequestException('Invalid query params JSON');
        }
        queryParams = parsed as unknown as QueryParams;
      } catch {
        throw new BadRequestException('Invalid query params JSON');
      }
    }
    return this.workshopService.findAll(queryParams);
  }
}
