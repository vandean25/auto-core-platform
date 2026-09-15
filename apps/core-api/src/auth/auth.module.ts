import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthController } from './auth.controller.js';
import { AuthSessionService } from './auth-session.service.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { SuperAdminGuard } from './super-admin.guard.js';
import { AUTH_SERVICE_TOKEN } from './auth.tokens.js';

@Module({
  imports: [JwtModule.register({}), forwardRef(() => PrismaModule)],
  controllers: [AuthController],
  providers: [
    AuthSessionService,
    AuthService,
    { provide: AUTH_SERVICE_TOKEN, useExisting: AuthService },
    JwtAuthGuard,
    SuperAdminGuard,
  ],
  exports: [
    AuthSessionService,
    AuthService,
    AUTH_SERVICE_TOKEN,
    JwtAuthGuard,
    SuperAdminGuard,
  ],
})
export class AuthModule {}
