import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import {
  NovaCalculateRequestDto,
  NovaCalculateResponseDto,
  NovaCalculationErrorResponseDto,
} from './dto/nova-calculate.dto.js';
import { NovaCalculationService } from './nova-calculation.service.js';

/**
 * NoVA preview. Tag and operation id keep the `Vehicle` names the OpenAPI contract and
 * generated client already use.
 */
@ApiTags('Vehicle')
@Controller('vehicles')
export class VehicleNovaController {
  constructor(
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
}
