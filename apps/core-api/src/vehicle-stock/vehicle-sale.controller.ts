import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { VehicleSaleService } from './vehicle-sale.service';
import { CreateVehicleSaleDto } from './dto/create-vehicle-sale.dto';
import { PatchVehicleSaleDto } from './dto/patch-vehicle-sale.dto';

@ApiTags('vehicle-sales')
@Controller('vehicle-sales')
export class VehicleSaleController {
  constructor(private readonly sales: VehicleSaleService) {}

  @Post()
  create(@Body() dto: CreateVehicleSaleDto) {
    return this.sales.create(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.sales.findOne(id);
  }

  @Patch(':id')
  updateDraft(@Param('id') id: string, @Body() dto: PatchVehicleSaleDto) {
    return this.sales.updateDraft(id, dto);
  }

  @Post(':id/finalize')
  finalize(@Param('id') id: string) {
    return this.sales.finalize(id);
  }
}
