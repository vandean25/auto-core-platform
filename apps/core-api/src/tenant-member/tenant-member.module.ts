import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { TenantMemberController } from './tenant-member.controller.js';
import { TenantMemberService } from './tenant-member.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [TenantMemberController],
  providers: [TenantMemberService],
  exports: [TenantMemberService],
})
export class TenantMemberModule {}
