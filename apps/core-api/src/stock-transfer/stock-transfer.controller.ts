import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApproveStockTransferDto,
  CancelStockTransferDto,
  CreateStockTransferDto,
  ReceiveStockTransferDto,
  RejectStockTransferDto,
  ReturnStockTransferDto,
  ShipStockTransferDto,
} from './dto/stock-transfer.dto.js';
import { StockTransferResponseDto } from './dto/stock-transfer-response.dto.js';
import { StockTransferService } from './stock-transfer.service.js';

@ApiTags('stock-transfers')
@Controller('stock-transfers')
export class StockTransferController {
  constructor(private readonly stockTransferService: StockTransferService) {}

  @Get()
  @ApiOperation({
    summary:
      'List same-GmbH stock transfers (membership on from or to; source bins redacted without from-site access)',
  })
  @ApiOkResponse({ type: [StockTransferResponseDto] })
  list() {
    return this.stockTransferService.list();
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Get a stock transfer (404 without membership on from or to; source bins redacted without from-site access)',
  })
  @ApiOkResponse({ type: StockTransferResponseDto })
  detail(@Param('id') id: string) {
    return this.stockTransferService.detail(id);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a stock transfer request (membership on from or to)',
  })
  @ApiCreatedResponse({ type: StockTransferResponseDto })
  create(@Body() dto: CreateStockTransferDto) {
    return this.stockTransferService.create(dto);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve a requested transfer (from OWNER/ADMIN)' })
  @ApiCreatedResponse({ type: StockTransferResponseDto })
  approve(@Param('id') id: string, @Body() dto: ApproveStockTransferDto) {
    return this.stockTransferService.approve(id, dto);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject a requested transfer (from OWNER/ADMIN)' })
  @ApiCreatedResponse({ type: StockTransferResponseDto })
  reject(@Param('id') id: string, @Body() dto: RejectStockTransferDto) {
    return this.stockTransferService.reject(id, dto);
  }

  @Post(':id/cancel')
  @ApiOperation({
    summary:
      'Cancel a requested/approved transfer (requester or from OWNER/ADMIN)',
  })
  @ApiCreatedResponse({ type: StockTransferResponseDto })
  cancel(@Param('id') id: string, @Body() dto: CancelStockTransferDto) {
    return this.stockTransferService.cancel(id, dto);
  }

  @Post(':id/ship')
  @ApiOperation({
    summary:
      'Ship an approved transfer one-shot and full (from-site membership)',
  })
  @ApiCreatedResponse({ type: StockTransferResponseDto })
  ship(@Param('id') id: string, @Body() dto: ShipStockTransferDto) {
    return this.stockTransferService.ship(id, dto);
  }

  @Post(':id/receive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Receive shipped stock into a destination bin (to-site membership)',
  })
  @ApiOkResponse({ type: StockTransferResponseDto })
  receive(@Param('id') id: string, @Body() dto: ReceiveStockTransferDto) {
    return this.stockTransferService.receive(id, dto);
  }

  @Post(':id/return')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Return unreceived stock to the source bin (to-site membership or from OWNER/ADMIN)',
  })
  @ApiOkResponse({ type: StockTransferResponseDto })
  returnTransfer(@Param('id') id: string, @Body() dto: ReturnStockTransferDto) {
    return this.stockTransferService.returnTransfer(id, dto);
  }
}
