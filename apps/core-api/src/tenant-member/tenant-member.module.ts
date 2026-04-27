import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantMemberController } from './tenant-member.controller';
import { TenantMemberService } from './tenant-member.service';

@Module({
  imports: [PrismaModule],
  controllers: [TenantMemberController],
  providers: [TenantMemberService],
  exports: [TenantMemberService],
})
export class TenantMemberModule {}