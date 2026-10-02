import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../common/dto/paginated-response.dto.js';
import {
  TyreSetDueListQueryDto,
  TyreSetListQueryDto,
} from './dto/tyre-set-list-query.dto.js';
import { TyreSetListEnvelopeDto } from './dto/tyre-set-list-response.dto.js';
import {
  CreateTyreSetDto,
  TyreSetLocationActionDto,
  TyreSetResponseDto,
  TyreStorageSettingsResponseDto,
  UpdateTyreSetDto,
  UpdateTyreStorageSettingsDto,
} from './dto/tyre-set.dto.js';
import { TyreStorageService } from './tyre-storage.service.js';

@ApiTags('tyre-sets')
@Controller('tyre-sets')
export class TyreStorageController {
  constructor(private readonly tyreStorageService: TyreStorageService) {}

  @Get('settings')
  @ApiOperation({ summary: 'Tenant tyre storage season swap defaults' })
  @ApiOkResponse({ type: TyreStorageSettingsResponseDto })
  getSettings() {
    return this.tyreStorageService.getSettings();
  }

  @Put('settings')
  @ApiOperation({ summary: 'Update tenant tyre storage season swap defaults' })
  @ApiOkResponse({ type: TyreStorageSettingsResponseDto })
  updateSettings(@Body() dto: UpdateTyreStorageSettingsDto) {
    return this.tyreStorageService.updateSettings(dto);
  }

  @Get('due-for-swap')
  @ApiOperation({
    summary: 'List stored sets approaching planned swap (manual calling only)',
  })
  @ApiOkResponse({ type: TyreSetListEnvelopeDto })
  dueForSwap(@Query() query: TyreSetDueListQueryDto) {
    return this.tyreStorageService.listDueForSwap(query.asOf);
  }

  @Get('due-for-swap/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: 'CSV export for due-for-swap list' })
  async exportDueForSwap() {
    return this.tyreStorageService.exportDueForSwapCsv();
  }

  @Get('by-customer/:customerId')
  @ApiPaginatedResponse(TyreSetResponseDto)
  byCustomer(@Param('customerId') customerId: string) {
    return this.tyreStorageService.findByCustomer(customerId);
  }

  @Get('by-vehicle/:vehicleId')
  @ApiOkResponse({ type: TyreSetListEnvelopeDto })
  byVehicle(@Param('vehicleId') vehicleId: string) {
    return this.tyreStorageService.findByVehicle(vehicleId);
  }

  @Get()
  @ApiPaginatedResponse(TyreSetResponseDto)
  list(@Query() query: TyreSetListQueryDto) {
    return this.tyreStorageService.list(query);
  }

  @Get(':id')
  @ApiOkResponse({ type: TyreSetResponseDto })
  findOne(@Param('id') id: string) {
    return this.tyreStorageService.findOne(id);
  }

  @Post()
  @ApiCreatedResponse({ type: TyreSetResponseDto })
  create(@Body() dto: CreateTyreSetDto) {
    return this.tyreStorageService.create(dto);
  }

  @Patch(':id')
  @ApiOkResponse({ type: TyreSetResponseDto })
  update(@Param('id') id: string, @Body() dto: UpdateTyreSetDto) {
    return this.tyreStorageService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.tyreStorageService.remove(id);
  }

  @Post(':id/check-in')
  @HttpCode(200)
  @ApiOkResponse({ type: TyreSetResponseDto })
  checkIn(@Param('id') id: string, @Body() dto: TyreSetLocationActionDto) {
    return this.tyreStorageService.checkIn(id, dto);
  }

  @Post(':id/check-out')
  @HttpCode(200)
  @ApiOkResponse({ type: TyreSetResponseDto })
  checkOut(@Param('id') id: string, @Body() dto: TyreSetLocationActionDto) {
    return this.tyreStorageService.checkOut(id, dto);
  }

  @Post(':id/move')
  @HttpCode(200)
  @ApiOkResponse({ type: TyreSetResponseDto })
  move(@Param('id') id: string, @Body() dto: TyreSetLocationActionDto) {
    return this.tyreStorageService.move(id, dto);
  }

  @Post(':id/dispose')
  @HttpCode(200)
  @ApiOkResponse({ type: TyreSetResponseDto })
  dispose(@Param('id') id: string, @Body() dto: TyreSetLocationActionDto) {
    return this.tyreStorageService.dispose(id, dto);
  }
}
