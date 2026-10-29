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
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import { pipeline } from 'node:stream/promises';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiHeader,
  ApiProduces,
  ApiAcceptedResponse,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ImportJobStatus, ImportRowAction } from '@prisma/client';
import { ImportService } from './import.service.js';
import { ImportDirectUploadService } from './import-direct-upload.service.js';
import { parseImportEntityType } from './import-entity-type.guard.js';
import { IMPLEMENTED_IMPORT_ENTITY_TYPES } from './import-entity-type.registry.js';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import { importUploadMulterOptions } from './import-multer.storage.js';
import { ImportUploadInterceptor } from './import-upload.interceptor.js';
import { ImportJobResponseDto } from './dto/import-job-response.dto.js';
import { ImportJobListResponseDto } from './dto/import-job-list-response.dto.js';
import { ImportJobRowsResponseDto } from './dto/import-job-rows-response.dto.js';
import { ImportTemplateResponseDto } from './dto/import-template-response.dto.js';
import { ImportEntityTypeListResponseDto } from './dto/import-entity-type-response.dto.js';
import { ImportMappingProfileService } from './import-mapping-profile.service.js';
import {
  ImportMappingProfileListResponseDto,
  ImportMappingProfileResponseDto,
} from './dto/import-mapping-profile-response.dto.js';
import { CreateImportMappingProfileDto } from './dto/create-import-mapping-profile.dto.js';
import { ApplyImportJobDto } from './dto/apply-import-job.dto.js';
import {
  FinalizeDirectImportUploadDto,
  StartDirectImportUploadDto,
} from './dto/direct-import-upload.dto.js';
import { StartDirectImportUploadResponseDto } from './dto/start-direct-import-upload-response.dto.js';

@ApiTags('imports')
@Controller('imports')
export class ImportController {
  constructor(
    private readonly importService: ImportService,
    private readonly directUploadService: ImportDirectUploadService,
    private readonly mappingProfileService: ImportMappingProfileService,
  ) {}

  @Post()
  @UseInterceptors(
    ImportUploadInterceptor,
    FileInterceptor('file', importUploadMulterOptions),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload CSV and run a synchronous import dry-run' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'entityType', 'sourceSystem', 'mapping'],
      properties: {
        file: { type: 'string', format: 'binary' },
        entityType: {
          type: 'string',
          enum: [...IMPLEMENTED_IMPORT_ENTITY_TYPES],
        },
        sourceSystem: { type: 'string', example: 'legacy-dms' },
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
    @Req() uploadRequest: Request,
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
      uploadRequest,
      file: file as Express.Multer.File,
      entityType: parseImportEntityType(entityType),
      sourceSystem: sourceSystem?.trim() ?? 'legacy',
      mappingJson: parsedMapping,
      optionsJson: parsedOptions,
    });
  }

  @Post('direct-uploads')
  @ApiOperation({
    summary:
      'Issue a signed resumable GCS upload URL for files above the HTTP limit',
  })
  @ApiCreatedResponse({ type: StartDirectImportUploadResponseDto })
  startDirectUpload(@Body() body: StartDirectImportUploadDto) {
    return this.directUploadService.start(body);
  }

  @Post('direct-uploads/:uploadId/finalize')
  @ApiOperation({
    summary:
      'Verify and promote a staged direct upload, then start the background dry-run',
  })
  @ApiCreatedResponse({ type: ImportJobResponseDto })
  finalizeDirectUpload(
    @Param('uploadId') uploadId: string,
    @Body() body: FinalizeDirectImportUploadDto,
  ) {
    return this.directUploadService.finalize({
      uploadId,
      fileName: body.fileName,
      size: body.size,
      entityType: body.entityType,
      sourceSystem: body.sourceSystem.trim(),
      mapping: body.mapping,
      options: body.options,
    });
  }

  @Get('mapping-profiles')
  @ApiOperation({
    summary: 'List saved column mapping profiles for a source system',
  })
  @ApiQuery({
    name: 'entityType',
    required: true,
    enum: [...IMPLEMENTED_IMPORT_ENTITY_TYPES],
  })
  @ApiQuery({ name: 'sourceSystem', required: true })
  @ApiOkResponse({ type: ImportMappingProfileListResponseDto })
  async listMappingProfiles(
    @Query('entityType') entityType: string,
    @Query('sourceSystem') sourceSystem: string,
  ) {
    const data = await this.mappingProfileService.listProfiles({
      entityType: parseImportEntityType(entityType),
      sourceSystem,
    });
    return { data };
  }

  @Post('mapping-profiles')
  @ApiOperation({ summary: 'Save a named column mapping profile' })
  @ApiCreatedResponse({ type: ImportMappingProfileResponseDto })
  createMappingProfile(@Body() body: CreateImportMappingProfileDto) {
    return this.mappingProfileService.createProfile(body);
  }

  @Get('templates/:entityType')
  @ApiOperation({ summary: 'CSV template metadata and inline CSV content' })
  @ApiOkResponse({ type: ImportTemplateResponseDto })
  getTemplate(@Param('entityType') entityType: string) {
    return this.importService.getTemplate(parseImportEntityType(entityType));
  }

  @Get('templates/:entityType/csv')
  @ApiOperation({ summary: 'Download CSV import template (German headers)' })
  @Header('Content-Type', 'text/csv; charset=utf-8')
  downloadTemplateCsv(
    @Param('entityType') entityType: string,
    @Res() res: Response,
  ) {
    const template = this.importService.getTemplate(
      parseImportEntityType(entityType),
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${entityType.toLowerCase()}-import-template.csv"`,
    );
    res.send(template.csv);
  }

  @Get('entity-types')
  @ApiOperation({
    summary:
      'List the importable entity types with wizard availability and required template fields',
  })
  @ApiOkResponse({ type: ImportEntityTypeListResponseDto })
  listEntityTypes() {
    return { data: this.importService.listEntityTypes() };
  }

  @Get()
  @ApiOperation({
    summary: 'List import jobs for the tenant, newest first',
  })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ImportJobStatus })
  @ApiQuery({
    name: 'entityType',
    required: false,
    enum: [...IMPLEMENTED_IMPORT_ENTITY_TYPES],
  })
  @ApiQuery({ name: 'source', required: false })
  @ApiOkResponse({ type: ImportJobListResponseDto })
  listJobs(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('entityType') entityType?: string,
    @Query('source') source?: string,
  ) {
    return this.importService.listJobs({
      page: this.parsePaginationInt(page, 'page', 1_000_000),
      limit: this.parsePaginationInt(limit, 'limit', 100),
      status: this.parseStatusFilter(status),
      entityType: entityType ? parseImportEntityType(entityType) : undefined,
      source: source?.trim() || undefined,
    });
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
  @ApiOperation({
    summary: 'Stream localized error rows with original source columns',
  })
  @ApiHeader({
    name: 'Accept-Language',
    required: false,
    description: 'Report language (de or en); defaults to the user preference',
  })
  @ApiProduces('text/csv')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async downloadErrors(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const language = req.get('Accept-Language');
    const locale =
      language && language.trim() !== '*'
        ? req.acceptsLanguages('de', 'en')
        : false;
    const csv = await this.importService.downloadErrorRowsCsv(
      id,
      locale === 'de' || locale === 'en' ? locale : undefined,
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="import-${id}-errors.csv"`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    await pipeline(csv, res);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get import job summary' })
  @ApiOkResponse({ type: ImportJobResponseDto })
  getJob(@Param('id') id: string) {
    return this.importService.getJob(id);
  }

  @Post(':id/apply')
  @ApiOperation({
    summary:
      'Enqueue apply for a dry-run import job and return the current job',
  })
  @ApiBody({ type: ApplyImportJobDto, required: false })
  @ApiAcceptedResponse({ type: ImportJobResponseDto })
  @ApiOkResponse({ type: ImportJobResponseDto })
  async apply(
    @Param('id') id: string,
    @Body() body: ApplyImportJobDto | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const outcome = await this.importService.applyJobHttp(id, body);
    res.status(outcome.httpStatus);
    return outcome.job;
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a background import job before apply' })
  @ApiOkResponse({ type: ImportJobResponseDto })
  cancel(@Param('id') id: string) {
    return this.importService.cancelJob(id);
  }

  private parseStatusFilter(status?: string): ImportJobStatus | undefined {
    const trimmed = status?.trim();
    if (!trimmed) {
      return undefined;
    }
    const values = Object.values(ImportJobStatus) as string[];
    if (!values.includes(trimmed)) {
      throw new BadRequestException('Invalid status filter');
    }
    return trimmed as ImportJobStatus;
  }

  /**
   * Parses a pagination query param into a finite integer within `[1, max]`, so malformed input
   * (`abc`, `Infinity`, `1.5`, `0`) becomes a 400 instead of a Prisma error. The page cap keeps
   * the computed offset a safe integer.
   */
  private parsePaginationInt(
    raw: string | undefined,
    field: string,
    max: number,
  ): number | undefined {
    const trimmed = raw?.trim();
    if (!trimmed) {
      return undefined;
    }
    const value = Number(trimmed);
    if (!Number.isInteger(value) || value < 1 || value > max) {
      throw new BadRequestException(`Invalid ${field} parameter`);
    }
    return value;
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
