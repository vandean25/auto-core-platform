import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiHeader,
  ApiOkResponse,
  ApiQuery,
  ApiOperation,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { InventoryService } from './inventory.service.js';
import { LedgerService } from './ledger.service.js';
import { InventoryItemMutationsService } from './inventory-item-mutations.service.js';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto.js';
import {
  AvailabilityCheckResultDto,
  CatalogItemResponseDto,
  InventoryItemDetailResponseDto,
  InventoryItemResponseDto,
  InventoryTransactionResponseDto,
} from './dto/inventory-response.dto.js';
import { ApiPaginatedResponse } from '../common/dto/paginated-response.dto.js';
import {
  ApiInventorySort,
  parsePositiveInt,
  parseSortDirection,
} from './inventory-list-query.js';
import { ReceiveInventoryStockDto } from './dto/receive-inventory-stock.dto.js';
import { AdjustInventoryStockDto } from './dto/adjust-inventory-stock.dto.js';
import {
  GuardedInventoryPricePatchDto,
  GuardedPriceErrorDto,
  GuardedPriceReceiptDto,
} from './dto/guarded-inventory-price.dto.js';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto.js';
import { InventoryPatchBodyPipe } from './inventory-patch-body.pipe.js';
import { GuardedPriceService } from './guarded-price/guarded-price.service.js';
import { CappedListCountResponseDto } from '../common/dto/list-cursor-response.dto.js';
import { ApiListCursorModeQuery } from '../common/dto/list-cursor-query.decorator.js';

@ApiExtraModels(
  GuardedInventoryPricePatchDto,
  GuardedPriceReceiptDto,
  GuardedPriceErrorDto,
  UpdateInventoryItemDto,
)
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly ledgerService: LedgerService,
    private readonly inventoryItemMutations: InventoryItemMutationsService,
    private readonly guardedPrice: GuardedPriceService,
    private readonly inventoryPatchBodyPipe: InventoryPatchBodyPipe,
  ) {}

  @Get('availability/:sku')
  @ApiOkResponse({ type: AvailabilityCheckResultDto })
  async checkAvailability(@Param('sku') sku: string) {
    return await this.inventoryService.checkAvailability(sku);
  }

  @Get('capped-count')
  @ApiOperation({
    summary: 'Bounded match count for parts list filters (ADR-0035 pilot)',
  })
  @ApiOkResponse({ type: CappedListCountResponseDto })
  async cappedCount(
    @Query('search') search?: string,
    @Query('location') location?: string,
    @Query('brand') brand?: string,
    @Query('brandId') brandId?: string,
  ) {
    return await this.inventoryService.cappedListCount({
      search,
      location,
      brand,
      brandId: parsePositiveInt(brandId),
    });
  }

  @Get(':id/history')
  @ApiOkResponse({ type: [InventoryTransactionResponseDto] })
  async getHistory(@Param('id', ParseUUIDPipe) id: string) {
    const transactions = await this.ledgerService.getTransactionHistory(id);
    return transactions.slice(0, 20);
  }

  @Get(':id')
  @ApiOkResponse({ type: InventoryItemDetailResponseDto })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return await this.inventoryService.findOne(id);
  }

  @Post(':id/receive')
  @HttpCode(HttpStatus.NO_CONTENT)
  async receiveStock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceiveInventoryStockDto,
  ) {
    await this.inventoryItemMutations.receiveStock(id, dto);
  }

  @Post(':id/adjust')
  @HttpCode(HttpStatus.NO_CONTENT)
  async adjustStock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustInventoryStockDto,
  ) {
    await this.inventoryItemMutations.adjustStock(id, dto);
  }

  @Patch(':id')
  @ApiBody({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(UpdateInventoryItemDto) },
        { $ref: getSchemaPath(GuardedInventoryPricePatchDto) },
      ],
    },
  })
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(CatalogItemResponseDto) },
        { $ref: getSchemaPath(GuardedPriceReceiptDto) },
      ],
    },
  })
  @ApiResponse({ status: 200, type: GuardedPriceReceiptDto, description: 'Guarded price receipt (retail_price + expectedRevision body)' })
  @ApiResponse({ status: 400, type: GuardedPriceErrorDto })
  @ApiResponse({ status: 409, type: GuardedPriceErrorDto })
  @ApiResponse({ status: 410, type: GuardedPriceErrorDto })
  @ApiResponse({ status: 422, type: GuardedPriceErrorDto })
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'UUIDv7; required for guarded PATCH (expectedRevision present)' })
  @ApiQuery({ name: 'operationKey', required: false, description: 'Fallback for Idempotency-Key when a proxy strips the header' })
  async updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Query('operationKey') operationKey?: string,
  ) {
    const body = this.inventoryPatchBodyPipe.transform(req.body, {
      type: 'body',
      metatype: Object,
    });
    if (body.mode === 'guarded') {
      return await this.guardedPrice.patchGuardedPrice(
        id,
        body.retailPrice,
        body.expectedRevision,
        idempotencyKey,
        operationKey,
      );
    }
    return await this.inventoryItemMutations.updateItem(id, body.dto);
  }

  @Get()
  @ApiListCursorModeQuery()
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1 },
  })
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
  @ApiQuery({ name: 'search', required: false, schema: { type: 'string' } })
  @ApiQuery({ name: 'location', required: false, schema: { type: 'string' } })
  @ApiQuery({ name: 'brand', required: false, schema: { type: 'string' } })
  @ApiQuery({
    name: 'brandId',
    required: false,
    schema: { type: 'integer', minimum: 1 },
  })
  @ApiInventorySort()
  @ApiPaginatedResponse(InventoryItemResponseDto)
  async findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('location') location?: string,
    @Query('brand') brand?: string,
    @Query('brandId') brandId?: string,
    @Query('sortField') sortField?: string,
    @Query('sortDirection') sortDirection?: string,
    @Query('limit') limit?: string,
    @Query('pagination') pagination?: string,
    @Query('cursor') cursor?: string,
  ) {
    const useCursor = pagination === 'cursor' || Boolean(cursor);
    if (useCursor) {
      return await this.inventoryService.findAllWithCursor({
        page: parsePositiveInt(page, 1),
        pageSize: parsePositiveInt(pageSize),
        limit: parsePositiveInt(limit, 10),
        search,
        location,
        brand,
        brandId: parsePositiveInt(brandId),
        sortField,
        sortDirection: parseSortDirection(sortDirection),
        cursor,
      });
    }
    return await this.inventoryService.findAll({
      page: parsePositiveInt(page, 1),
      pageSize: parsePositiveInt(pageSize, 10),
      search,
      location,
      brand,
      brandId: parsePositiveInt(brandId),
      sortField,
      sortDirection: parseSortDirection(sortDirection),
    });
  }

  @Post()
  @ApiCreatedResponse({ type: CatalogItemResponseDto })
  async createItem(@Body() createInventoryItemDto: CreateInventoryItemDto) {
    return await this.inventoryService.createItem(createInventoryItemDto);
  }
}
