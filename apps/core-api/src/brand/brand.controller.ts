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
import { BrandResponseDto } from './dto/brand-response.dto';

@Controller('brands')
export class BrandController {
  constructor(private readonly brandService: BrandService) {}

  @Post()
  @ApiCreatedResponse({ type: BrandResponseDto })
  create(@Body() createBrandDto: CreateBrandDto) {
    return this.brandService.create(createBrandDto);
  }

  @Get()
  @ApiOkResponse({ type: [BrandResponseDto] })
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
  @ApiOkResponse({ type: BrandResponseDto })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.brandService.findOne(id);
  }

  @Patch(':id')
  @ApiOkResponse({ type: BrandResponseDto })
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
