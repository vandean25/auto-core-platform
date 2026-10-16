import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthController } from './auth.controller.js';
import { AuthLocalePreferencesController } from './auth-locale-preferences.controller.js';
import { AuthSessionService } from './auth-session.service.js';
import { InteractiveUserGuard } from './guards/interactive-user.guard.js';
import { UserLocalePreferencesService } from './user-locale-preferences.service.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { SuperAdminGuard } from './super-admin.guard.js';
import { AUTH_SERVICE_TOKEN } from './auth.tokens.js';
import { LandingDemoSignInGrantModule } from '../landing-demo-access/landing-demo-sign-in-grant.module.js';

@Module({
  imports: [
    JwtModule.register({}),
    forwardRef(() => PrismaModule),
    LandingDemoSignInGrantModule,
  ],
  controllers: [AuthController, AuthLocalePreferencesController],
  providers: [
    AuthSessionService,
    UserLocalePreferencesService,
    InteractiveUserGuard,
    AuthService,
    { provide: AUTH_SERVICE_TOKEN, useExisting: AuthService },
    JwtAuthGuard,
    SuperAdminGuard,
  ],
  exports: [
    AuthSessionService,
    UserLocalePreferencesService,
    AuthService,
    AUTH_SERVICE_TOKEN,
    JwtAuthGuard,
    SuperAdminGuard,
  ],
})
export class AuthModule {}
