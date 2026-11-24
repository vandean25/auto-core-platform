import { Module } from '@nestjs/common';
import { CustomerService } from './customer.service.js';
import { CustomerActivityService } from './activity/customer-activity.service.js';
import { CustomerController } from './customer.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [CustomerController],
  providers: [CustomerService, CustomerActivityService],
  exports: [CustomerService, CustomerActivityService],
})
export class CustomerModule {}
