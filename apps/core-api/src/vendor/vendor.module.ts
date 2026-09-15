import { Module } from '@nestjs/common';
import { VendorService } from './vendor.service.js';
import { VendorController } from './vendor.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [VendorController],
  providers: [VendorService],
})
export class VendorModule {}
