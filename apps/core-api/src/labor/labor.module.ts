import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LaborController } from './labor.controller';
import { LaborService } from './labor.service';
import { LaborCategoryService } from './labor-category.service';

@Module({
  imports: [PrismaModule],
  controllers: [LaborController],
  providers: [LaborService, LaborCategoryService],
})
export class LaborModule {}
