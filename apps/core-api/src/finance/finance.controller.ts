import { Controller, Get, Patch, Post, Body } from '@nestjs/common';
import { FinanceService } from './finance.service';
import { UpdateFinanceSettingsDto } from './dto/update-finance-settings.dto';
import { CreateRevenueGroupDto } from './dto/create-revenue-group.dto';

@Controller('finance')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get('settings')
  getSettings() {
    return this.financeService.getSettings();
  }

  @Patch('settings')
  updateSettings(@Body() data: UpdateFinanceSettingsDto) {
    return this.financeService.updateSettings(data);
  }

  @Get('revenue-groups')
  getRevenueGroups() {
    return this.financeService.getRevenueGroups();
  }

  @Post('revenue-groups')
  createRevenueGroup(@Body() data: CreateRevenueGroupDto) {
    return this.financeService.createRevenueGroup(data);
  }
}
