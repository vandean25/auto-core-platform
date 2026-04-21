import { Controller, Get, Patch, Post, Body } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { FinanceService } from './finance.service';
import { UpdateFinanceSettingsDto } from './dto/update-finance-settings.dto';
import { CreateRevenueGroupDto } from './dto/create-revenue-group.dto';

@Controller('finance')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get('settings')
  @ApiOkResponse({
    schema: { type: 'object' },
  })
  getSettings() {
    return this.financeService.getSettings();
  }

  @Patch('settings')
  @ApiOkResponse({
    schema: { type: 'object' },
  })
  updateSettings(@Body() data: UpdateFinanceSettingsDto) {
    return this.financeService.updateSettings(data);
  }

  @Get('revenue-groups')
  @ApiOkResponse({
    schema: { type: 'array', items: { type: 'object' } },
  })
  getRevenueGroups() {
    return this.financeService.getRevenueGroups();
  }

  @Post('revenue-groups')
  @ApiCreatedResponse({
    schema: { type: 'object' },
  })
  createRevenueGroup(@Body() data: CreateRevenueGroupDto) {
    return this.financeService.createRevenueGroup(data);
  }

  @Get('analytics/revenue-by-group')
  @ApiOkResponse({
    schema: { type: 'object' },
  })
  getRevenueAnalytics() {
    return this.financeService.getRevenueAnalytics();
  }
}
