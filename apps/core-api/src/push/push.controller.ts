import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  PushDeviceDto,
  PushPreferencesDto,
  PushTestResponseDto,
  RegisterPushDeviceDto,
} from './dto/push.dto.js';
import { PushService } from './push.service.js';

/** The caller's own push devices and settings (ADR-0033). Scoped to the signed-in user and active tenant. */
@ApiTags('me')
@Controller('v1/me/push')
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Get('devices')
  @ApiOperation({ summary: 'List my active push devices' })
  @ApiOkResponse({ type: [PushDeviceDto] })
  listDevices() {
    return this.pushService.listDevices();
  }

  @Post('devices')
  @ApiOperation({
    summary: 'Register this browser for push',
    description:
      'Call only after the user pressed a button and granted the browser permission. An existing token is taken over by the caller.',
  })
  @ApiCreatedResponse({ type: PushDeviceDto })
  registerDevice(@Body() dto: RegisterPushDeviceDto) {
    return this.pushService.registerDevice(dto);
  }

  @Delete('devices/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove one of my push devices' })
  @ApiNoContentResponse()
  revokeDevice(@Param('id', ParseUUIDPipe) id: string) {
    return this.pushService.revokeDevice(id);
  }

  @Get('preferences')
  @ApiOperation({ summary: 'My push events and quiet hours' })
  @ApiOkResponse({ type: PushPreferencesDto })
  getPreferences() {
    return this.pushService.getPreferences();
  }

  @Put('preferences')
  @ApiOperation({ summary: 'Replace my push events and quiet hours' })
  @ApiOkResponse({ type: PushPreferencesDto })
  updatePreferences(@Body() dto: PushPreferencesDto) {
    return this.pushService.updatePreferences(dto);
  }

  @Post('test')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Send a test push to my own devices',
    description: 'Limited to 5 per hour. 409 when no device is registered.',
  })
  @ApiAcceptedResponse({ type: PushTestResponseDto })
  sendTest() {
    return this.pushService.sendTest();
  }
}
