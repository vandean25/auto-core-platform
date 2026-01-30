import { Controller, Get, Patch, Post, Body } from '@nestjs/common';
import { FinanceService } from './finance.service';

@Controller('finance')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get('settings')
  getSettings() {
    return this.financeService.getSettings();
  }

  @Patch('settings')
  updateSettings(@Body() data: any) {
    return this.financeService.updateSettings(data);
  }

  @Get('revenue-groups')
  getRevenueGroups() {
    return this.financeService.getRevenueGroups();
  }

  @Post('revenue-groups')
  createRevenueGroup(@Body() data: any) {
    return this.financeService.createRevenueGroup(data);
  }
}
