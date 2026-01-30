import { Controller, Get, Query } from '@nestjs/common';
import { CustomerService } from './customer.service';

@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Get()
  findAll(@Query('search') search?: string) {
    return this.customerService.findAll(search);
  }
}
