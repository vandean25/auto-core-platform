import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PickerlDueListExportQueryDto,
  PickerlDueListQueryDto,
  PickerlDuePaginatedResponseDto,
} from './dto/pickerl-due-list.dto.js';
import { OpenPickerlOrderDto } from './dto/vehicle-response.dto.js';
import { VehicleService } from './vehicle.service.js';

/**
 * Pickerl (periodic inspection) due list and open order lookup. Tag and operation ids keep the
 * `Vehicle` names the OpenAPI contract and generated client already use. `summary: undefined`
 * stops ApiOperation from adding an empty summary these routes never had.
 */
@ApiTags('Vehicle')
@Controller('vehicles')
export class VehiclePickerlDueController {
  constructor(private readonly vehicleService: VehicleService) {}

  @Get('pickerl-due')
  @ApiOperation({
    operationId: 'VehicleController_findPickerlDue',
    summary: undefined,
  })
  @ApiOkResponse({ type: PickerlDuePaginatedResponseDto })
  findPickerlDue(@Query() query: PickerlDueListQueryDto) {
    return this.vehicleService.findPickerlDue(query);
  }

  @Get('pickerl-due/export')
  @ApiOperation({
    operationId: 'VehicleController_exportPickerlDue',
    summary: undefined,
  })
  @Header('Content-Type', 'text/csv; charset=utf-8')
  exportPickerlDue(@Query() query: PickerlDueListExportQueryDto) {
    return this.vehicleService.exportPickerlDueCsv(query);
  }

  @Get(':id/pickerl-open-order')
  @ApiOperation({
    operationId: 'VehicleController_findOpenPickerlWorkshopOrder',
    summary: undefined,
  })
  @ApiOkResponse({ type: OpenPickerlOrderDto, nullable: true })
  findOpenPickerlWorkshopOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.vehicleService.findOpenPickerlWorkshopOrder(id);
  }
}
