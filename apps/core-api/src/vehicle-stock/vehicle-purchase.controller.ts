import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { VehiclePurchaseService } from './vehicle-purchase.service';
import { CreateVehiclePurchaseDto } from './dto/create-vehicle-purchase.dto';
import { PatchVehiclePurchaseDto } from './dto/patch-vehicle-purchase.dto';

@ApiTags('vehicle-purchases')
@Controller('vehicle-purchases')
export class VehiclePurchaseController {
  constructor(private readonly purchases: VehiclePurchaseService) {}

  @Post()
  create(@Body() dto: CreateVehiclePurchaseDto) {
    return this.purchases.create(dto);
  }

  @Get()
  findAll(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.purchases.findAll(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : pageSize ? parseInt(pageSize, 10) : 25,
      search,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.purchases.findOne(id);
  }

  @Patch(':id')
  updateDraft(@Param('id') id: string, @Body() dto: PatchVehiclePurchaseDto) {
    return this.purchases.updateDraft(id, dto);
  }

  @Post(':id/receive')
  receive(@Param('id') id: string) {
    return this.purchases.receive(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.purchases.cancel(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.purchases.remove(id);
  }
}
