import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CommonModule } from '../common/common.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AdminLogLevelController } from './admin-log-level.controller.js';
import { PlatformAdminController } from './platform-admin.controller.js';
import { PlatformAdminService } from './platform-admin.service.js';

@Module({
  imports: [PrismaModule, AuthModule, CommonModule],
  controllers: [PlatformAdminController, AdminLogLevelController],
  providers: [PlatformAdminService],
  exports: [PlatformAdminService],
})
export class PlatformAdminModule {}
