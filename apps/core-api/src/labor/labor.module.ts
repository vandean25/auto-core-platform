import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { LaborController } from './labor.controller.js';
import { LaborService } from './labor.service.js';
import { LaborCategoryService } from './labor-category.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [LaborController],
  providers: [LaborService, LaborCategoryService],
})
export class LaborModule {}
