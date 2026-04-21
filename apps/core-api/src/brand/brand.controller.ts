import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { BrandService } from './brand.service';
import { CreateBrandDto, UpdateBrandDto } from './dto/brand.dto';

@Controller('brands')
export class BrandController {
  constructor(private readonly brandService: BrandService) {}

  @Post()
  @ApiCreatedResponse({
    schema: { type: 'object' },
  })
  create(@Body() createBrandDto: CreateBrandDto) {
    return this.brandService.create(createBrandDto);
  }

  @Get()
  @ApiOkResponse({
    schema: { type: 'array', items: { type: 'object' } },
  })
  findAll(
    @Query('isVehicleMake') isVehicleMake?: string,
    @Query('isPartManufacturer') isPartManufacturer?: string,
  ) {
    return this.brandService.findAll({
      isVehicleMake:
        isVehicleMake === 'true'
          ? true
          : isVehicleMake === 'false'
            ? false
            : undefined,
      isPartManufacturer:
        isPartManufacturer === 'true'
          ? true
          : isPartManufacturer === 'false'
            ? false
            : undefined,
    });
  }

  @Get(':id')
  @ApiOkResponse({
    schema: { type: 'object' },
  })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.brandService.findOne(id);
  }

  @Patch(':id')
  @ApiOkResponse({
    schema: { type: 'object' },
  })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateBrandDto: UpdateBrandDto,
  ) {
    return this.brandService.update(id, updateBrandDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.brandService.remove(id);
  }
}
