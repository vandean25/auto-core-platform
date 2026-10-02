import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ImportEntityType, ImportRowAction } from '@prisma/client';
import { ImportService } from './import.service.js';
import {
  IMPORT_ERROR_CODES,
  IMPORT_MAX_FILE_BYTES,
} from './import.constants.js';
import { ImportJobResponseDto } from './dto/import-job-response.dto.js';
import { ImportJobRowsResponseDto } from './dto/import-job-rows-response.dto.js';
import { ImportTemplateResponseDto } from './dto/import-template-response.dto.js';

@ApiTags('imports')
@Controller('imports')
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: IMPORT_MAX_FILE_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload CSV and run a synchronous import dry-run' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'entityType', 'sourceSystem', 'mapping'],
      properties: {
        file: { type: 'string', format: 'binary' },
        entityType: { type: 'string', enum: ['CUSTOMER', 'VEHICLE'] },
        sourceSystem: { type: 'string', example: 'incadea' },
        mapping: {
          type: 'string',
          description: 'JSON object mapping logical fields to CSV headers',
        },
        options: {
          type: 'string',
          description: 'JSON import options',
        },
      },
    },
  })
  @ApiCreatedResponse({ type: ImportJobResponseDto })
  async createDryRun(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('entityType') entityType: string,
    @Body('sourceSystem') sourceSystem: string,
    @Body('mapping') mapping: string,
    @Body('options') options?: string,
  ) {
    const parsedMapping = this.parseJsonObject(mapping, 'mapping');
    const parsedOptions = options
      ? this.parseJsonObject(options, 'options')
      : {};
    return this.importService.createDryRunFromUpload({
      file: file as Express.Multer.File,
      entityType: this.parseEntityType(entityType),
      sourceSystem: sourceSystem?.trim() ?? 'legacy',
      mappingJson: parsedMapping,
      optionsJson: parsedOptions,
    });
  }

  @Get('templates/:entityType')
  @ApiOperation({ summary: 'CSV template metadata and inline CSV content' })
  @ApiOkResponse({ type: ImportTemplateResponseDto })
  getTemplate(@Param('entityType') entityType: string) {
    return this.importService.getTemplate(this.parseEntityType(entityType));
  }

  @Get('templates/:entityType/csv')
  @ApiOperation({ summary: 'Download CSV import template (German headers)' })
  @Header('Content-Type', 'text/csv; charset=utf-8')
  downloadTemplateCsv(
    @Param('entityType') entityType: string,
    @Res() res: Response,
  ) {
    const template = this.importService.getTemplate(
      this.parseEntityType(entityType),
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${entityType.toLowerCase()}-import-template.csv"`,
    );
    res.send(template.csv);
  }

  @Get(':id/rows')
  @ApiOperation({ summary: 'List dry-run rows for an import job' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'action', required: false, enum: ImportRowAction })
  @ApiQuery({ name: 'hasErrors', required: false, type: Boolean })
  @ApiOkResponse({ type: ImportJobRowsResponseDto })
  listRows(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('action') action?: ImportRowAction,
    @Query('hasErrors') hasErrors?: string,
  ) {
    return this.importService.listJobRows(id, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      action,
      hasErrors: hasErrors === 'true',
    });
  }

  @Get(':id/errors.csv')
  @ApiOperation({ summary: 'Download CSV of rows that failed validation' })
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async downloadErrors(@Param('id') id: string, @Res() res: Response) {
    const csv = await this.importService.downloadErrorRowsCsv(id);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="import-${id}-errors.csv"`,
    );
    res.send(csv);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get import job summary' })
  @ApiOkResponse({ type: ImportJobResponseDto })
  getJob(@Param('id') id: string) {
    return this.importService.getJob(id);
  }

  @Post(':id/apply')
  @HttpCode(200)
  @ApiOperation({ summary: 'Apply a completed dry-run import job' })
  @ApiOkResponse({ type: ImportJobResponseDto })
  apply(@Param('id') id: string) {
    return this.importService.applyJob(id);
  }

  private parseEntityType(value: string): ImportEntityType {
    const normalized = value?.trim().toUpperCase();
    if (normalized === ImportEntityType.CUSTOMER) {
      return ImportEntityType.CUSTOMER;
    }
    if (normalized === ImportEntityType.VEHICLE) {
      return ImportEntityType.VEHICLE;
    }
    throw new BadRequestException({
      code: IMPORT_ERROR_CODES.INVALID_ENTITY_TYPE,
      message: `Invalid entity type: ${value}`,
    });
  }

  private parseJsonObject(
    raw: string,
    fieldName: string,
  ): Record<string, string> {
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not an object');
      }
      return parsed;
    } catch {
      throw new BadRequestException({
        code: IMPORT_ERROR_CODES.INVALID_MAPPING,
        message: `Invalid JSON for ${fieldName}`,
      });
    }
  }
}
