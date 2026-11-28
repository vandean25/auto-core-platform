import {
  BadRequestException,
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
  Req,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import {
  CUSTOM_FIELD_FILTER_DESCRIPTION,
  CustomFieldFilterParams,
  CustomFieldListQuery,
} from '../custom-fields/custom-field-list-query.js';
import { SCOPE_CONTEXT_HEADER } from '../auth/scope-context/scope-context.constants.js';
import { ApiListCursorModeQuery } from '../common/dto/list-cursor-query.decorator.js';
import { CappedListCountResponseDto } from '../common/dto/list-cursor-response.dto.js';
import { VehicleService } from './vehicle.service.js';
import { VehicleListService } from './vehicle-list.service.js';
import { VehicleIdentityService } from './vehicle-identity.service.js';
import { VehicleValuationService } from './vehicle-valuation.service.js';
import {
  FindAllVehiclesQueryDto,
  VehiclesCappedCountQueryDto,
} from './dto/find-all-vehicles-query.dto.js';
import {
  CreateVehicleValuationDto,
  VehicleValuationErrorResponseDto,
  VehicleValuationResponseDto,
} from './dto/vehicle-valuation.dto.js';
import { UpdateVehicleDto } from './dto/update-vehicle.dto.js';
import { CreateVehicleDto } from './dto/create-vehicle.dto.js';
import {
  VehiclePaginatedResponseDto,
  VehicleResponseDto,
} from './dto/vehicle-response.dto.js';
import { DryRunSupported } from '../dry-run/dry-run.decorators.js';

function findAllVehiclesOffset(
  vehicleService: VehicleService,
  query: FindAllVehiclesQueryDto,
) {
  const { search, page, pageSize, sortField, sortDirection } = query;
  const integerPattern = /^\d+$/;
  const isInvalidPage =
    page !== undefined &&
    (!integerPattern.test(page) || parseInt(page, 10) <= 0);
  const isInvalidPageSize =
    pageSize !== undefined &&
    (!integerPattern.test(pageSize) || parseInt(pageSize, 10) <= 0);
  const isInvalidSortDirection =
    sortDirection !== undefined &&
    sortDirection !== 'asc' &&
    sortDirection !== 'desc';

  if (isInvalidPage || isInvalidPageSize) {
    throw new BadRequestException(
      'page and pageSize must be positive integers',
    );
  }
  if (isInvalidSortDirection) {
    throw new BadRequestException('sortDirection must be "asc" or "desc"');
  }

  return vehicleService.findAll({
    search,
    page: page ? parseInt(page, 10) : undefined,
    pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    sortField,
    sortDirection: sortDirection ? sortDirection : undefined,
  });
}

@Controller('vehicles')
export class VehicleController {
  constructor(
    private readonly vehicleService: VehicleService,
    private readonly vehicleList: VehicleListService,
    private readonly vehicleIdentityService: VehicleIdentityService,
    private readonly vehicleValuationService: VehicleValuationService,
  ) {}

  @Get('capped-count')
  @ApiOperation({
    operationId: 'VehicleController_cappedCount',
    description: CUSTOM_FIELD_FILTER_DESCRIPTION,
    summary: 'Bounded match count for the customer vehicle list (ADR-0035)',
  })
  @ApiQuery({ type: VehiclesCappedCountQueryDto, required: false })
  @ApiHeader({ name: SCOPE_CONTEXT_HEADER, required: true })
  @ApiOkResponse({ type: CappedListCountResponseDto })
  cappedCount(
    @CustomFieldListQuery(VehiclesCappedCountQueryDto)
    query: VehiclesCappedCountQueryDto,
    @Headers(SCOPE_CONTEXT_HEADER) scopeContext?: string,
    @CustomFieldFilterParams() customFields?: URLSearchParams,
  ) {
    return this.vehicleList.cappedListCount(query, scopeContext, customFields);
  }

  @Get()
  @ApiOperation({
    summary: 'List vehicles',
    description: CUSTOM_FIELD_FILTER_DESCRIPTION,
  })
  @ApiHeader({
    name: SCOPE_CONTEXT_HEADER,
    required: false,
    description: 'Required in cursor mode (ADR-0038).',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description:
      'Free-text search term for make, model, plate, VIN, engine code, customer, or legacy ID',
    schema: { type: 'string' },
  })
  @ApiQuery({
    name: 'page',
    required: false,
    schema: { type: 'integer', minimum: 1 },
  })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    description: 'Larger values are clamped to 50.',
    schema: { type: 'integer', minimum: 1, maximum: 50 },
  })
  @ApiQuery({ name: 'sortField', required: false, schema: { type: 'string' } })
  @ApiQuery({
    name: 'sortDirection',
    required: false,
    schema: { type: 'string', enum: ['asc', 'desc'] },
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Cursor mode only. Default 50, maximum 100.',
    schema: { type: 'string' },
  })
  @ApiListCursorModeQuery()
  @ApiOkResponse({ type: VehiclePaginatedResponseDto })
  async findAll(
    @CustomFieldListQuery(FindAllVehiclesQueryDto)
    query: FindAllVehiclesQueryDto,
    @Headers(SCOPE_CONTEXT_HEADER) scopeContext?: string,
    @CustomFieldFilterParams() customFields?: URLSearchParams,
  ) {
    if (query.pagination === 'cursor' || query.cursor) {
      return this.vehicleList.findAllWithCursor(
        query,
        scopeContext,
        customFields,
      );
    }
    await this.vehicleList.assertNoOffsetCustomFieldFilters(customFields);
    return findAllVehiclesOffset(this.vehicleService, query);
  }

  @Post()
  @DryRunSupported()
  @ApiCreatedResponse({ type: VehicleResponseDto })
  create(@Body() createVehicleDto: CreateVehicleDto) {
    return this.vehicleService.create(createVehicleDto);
  }

  @Post(':id/resolve-identity')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: VehicleResponseDto })
  resolveIdentity(@Param('id', ParseUUIDPipe) id: string) {
    return this.vehicleIdentityService.resolveIdentity(id);
  }

  @Get(':id/valuations')
  @ApiOperation({
    summary: 'List stored vehicle valuations (newest first)',
  })
  @ApiOkResponse({ type: [VehicleValuationResponseDto] })
  listValuations(@Param('id', ParseUUIDPipe) id: string) {
    return this.vehicleValuationService.listValuations(id);
  }

  @Post(':id/valuations')
  @ApiOperation({
    summary: 'Request a market valuation snapshot',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: VehicleValuationResponseDto })
  @ApiUnprocessableEntityResponse({ type: VehicleValuationErrorResponseDto })
  @ApiConflictResponse({ type: VehicleValuationErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: VehicleValuationErrorResponseDto })
  createValuation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateVehicleValuationDto,
    @Req() request: Request,
  ) {
    const header = request.headers['idempotency-key'];
    const idempotencyKey =
      typeof header === 'string'
        ? header
        : Array.isArray(header)
          ? header[0]
          : undefined;
    return this.vehicleValuationService.createValuation(
      id,
      dto,
      idempotencyKey,
    );
  }

  @Get(':id')
  @ApiOkResponse({ type: VehicleResponseDto })
  findOne(@Param('id') id: string) {
    return this.vehicleService.findOne(id);
  }

  @Patch(':id')
  @ApiOkResponse({ type: VehicleResponseDto })
  update(@Param('id') id: string, @Body() updateVehicleDto: UpdateVehicleDto) {
    return this.vehicleService.update(id, updateVehicleDto);
  }
}
