import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { UserAccessStatusService } from './user-access-status.service.js';

@Module({
  imports: [PrismaModule],
  providers: [UserAccessStatusService],
  exports: [UserAccessStatusService],
})
export class ScopeEpochModule {}
