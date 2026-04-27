import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { SuperAdminGuard } from './super-admin.guard';

@Module({
  imports: [JwtModule.register({}), forwardRef(() => PrismaModule)],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, SuperAdminGuard],
  exports: [AuthService, JwtAuthGuard, SuperAdminGuard],
})
export class AuthModule {}
