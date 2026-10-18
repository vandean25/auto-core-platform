import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Autoscout24DmsPushRequestDto,
  Autoscout24DmsPushResponseDto,
} from './dto/autoscout24-dms-push.dto.js';
import { Autoscout24DmsListingPushService } from './autoscout24-dms/autoscout24-dms-listing-push.service.js';

@ApiTags('vehicle-stock')
@Controller('vehicle-stock/:vehicleId/listing/export/as24-dms')
export class Autoscout24DmsPushController {
  constructor(private readonly pushService: Autoscout24DmsListingPushService) {}

  @Post('push')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Push the current AutoScout24 listing to the DMS API (feature-flagged, default off)',
  })
  @ApiCreatedResponse({ type: Autoscout24DmsPushResponseDto })
  push(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Body() dto: Autoscout24DmsPushRequestDto,
  ): Promise<Autoscout24DmsPushResponseDto> {
    return this.pushService.pushListing(vehicleId, {
      idempotency_key: dto.idempotency_key,
      expected_revision: dto.expected_revision,
      action: dto.action,
    });
  }
}
