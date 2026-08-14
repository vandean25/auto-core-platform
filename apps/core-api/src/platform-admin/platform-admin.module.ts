import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CommonModule } from '../common/common.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminLogLevelController } from './admin-log-level.controller';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminService } from './platform-admin.service';

@Module({
  imports: [PrismaModule, AuthModule, CommonModule],
  controllers: [PlatformAdminController, AdminLogLevelController],
  providers: [PlatformAdminService],
  exports: [PlatformAdminService],
})
export class PlatformAdminModule {}

