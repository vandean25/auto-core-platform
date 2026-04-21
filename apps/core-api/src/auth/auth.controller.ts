import { Controller, Get, Req } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthenticatedUser } from './types/authenticated-user';

@Controller('auth')
export class AuthController {
  @Get('me')
  @ApiOkResponse({
    description: 'Returns the authenticated user.',
    schema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        email: { type: 'string' },
        tenantId: { type: 'string' },
        role: { type: 'string' },
      },
      required: ['userId', 'email', 'tenantId', 'role'],
    },
  })
  getMe(@Req() request: Request & { user: AuthenticatedUser }): AuthenticatedUser {
    return request.user;
  }
}