import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiUnprocessableEntityResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Request } from 'express';
import {
  NovaCalculateRequestDto,
  NovaCalculateResponseDto,
  NovaCalculationErrorResponseDto,
} from './dto/nova-calculate.dto.js';
import {
  CreateVehicleValuationDto,
  VehicleValuationErrorResponseDto,
  VehicleValuationResponseDto,
} from './dto/vehicle-valuation.dto.js';
import { NovaCalculationService } from './nova-calculation.service.js';
import { VehicleValuationService } from './vehicle-valuation.service.js';

/**
 * NoVA preview and market valuation snapshots. Operation ids keep the `VehicleController_`
 * prefix the OpenAPI contract and generated client already use.
 */
@Controller('vehicles')
export class VehicleValuationController {
  constructor(
    private readonly vehicleValuationService: VehicleValuationService,
    private readonly novaCalculationService: NovaCalculationService,
  ) {}

  @Post('nova/calculate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'VehicleController_calculateNova',
    summary: 'Calculate a NoVA preview for vehicle inputs',
  })
  @ApiExtraModels(NovaCalculateRequestDto)
  @ApiBody({
    schema: {
      anyOf: [
        {
          allOf: [
            { $ref: getSchemaPath(NovaCalculateRequestDto) },
            {
              type: 'object',
              properties: { vehicleId: { type: 'string', format: 'uuid' } },
              required: ['vehicleId'],
            },
          ],
        },
        {
          allOf: [
            { $ref: getSchemaPath(NovaCalculateRequestDto) },
            {
              type: 'object',
              properties: {
                importMode: { type: 'string', enum: ['eu_used_m1'] },
              },
              required: ['importMode'],
            },
          ],
        },
        {
          allOf: [
            { $ref: getSchemaPath(NovaCalculateRequestDto) },
            {
              type: 'object',
              properties: {
                emissionCycle: { type: 'string', enum: ['WLTP', 'NEDC'] },
                driveType: {
                  type: 'string',
                  enum: ['BEV', 'FCEV', 'PHEV', 'ICE', 'OTHER'],
                },
                taxableEventDate: { type: 'string', format: 'date' },
              },
              required: ['emissionCycle', 'driveType', 'taxableEventDate'],
            },
          ],
        },
      ],
    },
  })
  @ApiOkResponse({ type: NovaCalculateResponseDto })
  @ApiUnprocessableEntityResponse({ type: NovaCalculationErrorResponseDto })
  @ApiNotFoundResponse({ description: 'Vehicle was not found' })
  calculateNova(@Body() request: NovaCalculateRequestDto) {
    return this.novaCalculationService.calculate(request);
  }

  @Get(':id/valuations')
  @ApiOperation({
    operationId: 'VehicleController_listValuations',
    summary: 'List stored vehicle valuations (newest first)',
  })
  @ApiOkResponse({ type: [VehicleValuationResponseDto] })
  listValuations(@Param('id', ParseUUIDPipe) id: string) {
    return this.vehicleValuationService.listValuations(id);
  }

  @Post(':id/valuations')
  @ApiOperation({
    operationId: 'VehicleController_createValuation',
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
}
