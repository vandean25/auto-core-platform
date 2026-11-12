import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { GuardedPriceErrorDto } from './dto/guarded-inventory-price.dto.js';
import {
  InventoryPriceOperationDto,
  InventoryPriceOperationListResponseDto,
  UserFenceInventoryPriceDto,
} from './dto/inventory-price-operation.dto.js';
import { GuardedPriceDiscoveryService } from './guarded-price/guarded-price-discovery.service.js';
import { GuardedPriceFenceService } from './guarded-price/guarded-price-fence.service.js';

@Controller('inventory/price-operations')
export class InventoryPriceOperationsController {
  constructor(
    private readonly discovery: GuardedPriceDiscoveryService,
    private readonly fenceService: GuardedPriceFenceService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List own guarded price operations within retention (ADR-0037)',
  })
  @ApiOkResponse({ type: InventoryPriceOperationListResponseDto })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Keyset cursor (acceptedAt DESC, key)',
  })
  async list(
    @Query('cursor') cursor?: string,
  ): Promise<InventoryPriceOperationListResponseDto> {
    return await this.discovery.listOperations(cursor);
  }

  @Get(':key')
  @ApiOperation({ summary: 'Read one own guarded price operation by key' })
  @ApiOkResponse({ type: InventoryPriceOperationDto })
  async getOne(@Param('key', ParseUUIDPipe) key: string) {
    return await this.discovery.getOperation(key);
  }

  @Post(':key/fence')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'User fence: mark a guarded price operation as not applied',
  })
  @ApiOkResponse({ type: InventoryPriceOperationDto })
  @ApiResponse({ status: 400, type: GuardedPriceErrorDto })
  @ApiResponse({ status: 409, type: GuardedPriceErrorDto })
  @ApiResponse({ status: 410, type: GuardedPriceErrorDto })
  @ApiResponse({ status: 422, type: GuardedPriceErrorDto })
  async fence(
    @Param('key', ParseUUIDPipe) key: string,
    @Body() body: UserFenceInventoryPriceDto,
  ) {
    return await this.fenceService.fenceOperation(key, body);
  }
}
