import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthSessionService } from './auth-session.service';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { SuperAdminGuard } from './super-admin.guard';

@Module({
  imports: [JwtModule.register({}), forwardRef(() => PrismaModule)],
  controllers: [AuthController],
  providers: [AuthSessionService, AuthService, JwtAuthGuard, SuperAdminGuard],
  exports: [AuthSessionService, AuthService, JwtAuthGuard, SuperAdminGuard],
})
export class AuthModule {}
