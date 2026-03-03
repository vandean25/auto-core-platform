import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LaborController } from './labor.controller';
import { LaborService } from './labor.service';

@Module({
  imports: [PrismaModule],
  controllers: [LaborController],
  providers: [LaborService],
})
export class LaborModule {}
