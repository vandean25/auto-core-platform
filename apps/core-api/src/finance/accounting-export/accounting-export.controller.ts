import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiProduces,
} from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../../common/dto/paginated-response.dto.js';
import { AccountingExportService } from './accounting-export.service.js';
import {
  AccountingExportCreatedResponseDto,
  AccountingExportDetailDto,
  AccountingExportListQueryDto,
  AccountingExportPreviewResponseDto,
  AccountingExportSummaryDto,
  GenerateAccountingExportDto,
  PreviewAccountingExportDto,
} from './dto/accounting-export.dto.js';

@Controller('finance/accounting-exports')
export class AccountingExportController {
  constructor(
    private readonly accountingExportService: AccountingExportService,
  ) {}

  @Post('preview')
  @HttpCode(200)
  @ApiOkResponse({ type: AccountingExportPreviewResponseDto })
  preview(@Body() dto: PreviewAccountingExportDto) {
    return this.accountingExportService.preview(dto);
  }

  @Post()
  @ApiCreatedResponse({ type: AccountingExportCreatedResponseDto })
  generate(@Body() dto: GenerateAccountingExportDto) {
    return this.accountingExportService.generate(dto);
  }

  @Get()
  @ApiPaginatedResponse(AccountingExportSummaryDto)
  list(@Query() query: AccountingExportListQueryDto) {
    return this.accountingExportService.list(query);
  }

  @Get(':id')
  @ApiOkResponse({ type: AccountingExportDetailDto })
  findOne(@Param('id') id: string) {
    return this.accountingExportService.findOne(id);
  }

  @Get(':id/download')
  @ApiProduces('text/csv')
  @Header('Cache-Control', 'no-store')
  async download(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.accountingExportService.download(id);
    const safeFilename = file.filename.replace(/["\r\n]+/g, '_');

    res.setHeader('X-Checksum-SHA256', file.sha256);
    res.setHeader('Digest', `SHA-256=${file.sha256}`);

    return new StreamableFile(file.bytes, {
      type: 'text/csv; charset=windows-1252',
      disposition: `attachment; filename="${safeFilename}"`,
      length: file.byteLength,
    });
  }
}
