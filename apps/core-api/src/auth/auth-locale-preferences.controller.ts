import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { AllowPlatformAdmin } from '../common/decorators/allow-platform-admin.decorator.js';
import { MechanicAccessible } from '../common/decorators/mechanic-accessible.decorator.js';
import {
  PatchUserLocalePreferencesDto,
  UserLocalePreferencesResponseDto,
} from './dto/user-locale-preferences.dto.js';
import { InteractiveUserGuard } from './guards/interactive-user.guard.js';
import { UserLocalePreferencesService } from './user-locale-preferences.service.js';
import type { AuthenticatedUser } from './types/authenticated-user.js';

@Controller('auth/me/preferences')
export class AuthLocalePreferencesController {
  constructor(
    private readonly userLocalePreferences: UserLocalePreferencesService,
  ) {}

  @Get()
  @AllowPlatformAdmin()
  @MechanicAccessible()
  @UseGuards(InteractiveUserGuard)
  @ApiOkResponse({ type: UserLocalePreferencesResponseDto })
  getPreferences(
    @Req() request: Request & { user: AuthenticatedUser },
  ): Promise<UserLocalePreferencesResponseDto> {
    return this.userLocalePreferences.getForPrincipal(request.user);
  }

  @Patch()
  @AllowPlatformAdmin()
  @MechanicAccessible()
  @UseGuards(InteractiveUserGuard)
  @ApiOkResponse({ type: UserLocalePreferencesResponseDto })
  patchPreferences(
    @Req() request: Request & { user: AuthenticatedUser },
    @Body() body: PatchUserLocalePreferencesDto,
  ): Promise<UserLocalePreferencesResponseDto> {
    return this.userLocalePreferences.patchForPrincipal(
      request.user,
      body.locale ?? null,
    );
  }
}
