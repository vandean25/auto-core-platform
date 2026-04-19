import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from './types/authenticated-user';

@Controller('auth')
export class AuthController {
  @Get('me')
  getMe(@Req() request: Request & { user: AuthenticatedUser }) {
    return request.user;
  }
}