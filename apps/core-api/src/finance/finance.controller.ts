import { Controller, Get, Patch, Post, Body } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { FinanceService } from './finance.service';
import { UpdateFinanceSettingsDto } from './dto/update-finance-settings.dto';
import { CreateRevenueGroupDto } from './dto/create-revenue-group.dto';
import {
  FinanceSettingsResponseDto,
  RevenueAnalyticsResponseDto,
  RevenueGroupResponseDto,
} from './dto/finance-response.dto';

@Controller('finance')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get('settings')
  @ApiOkResponse({ type: FinanceSettingsResponseDto })
  getSettings() {
    return this.financeService.getSettings();
  }

  @Patch('settings')
  @ApiOkResponse({ type: FinanceSettingsResponseDto })
  updateSettings(@Body() data: UpdateFinanceSettingsDto) {
    return this.financeService.updateSettings(data);
  }

  @Get('revenue-groups')
  @ApiOkResponse({ type: [RevenueGroupResponseDto] })
  getRevenueGroups() {
    return this.financeService.getRevenueGroups();
  }

  @Post('revenue-groups')
  @ApiCreatedResponse({ type: RevenueGroupResponseDto })
  createRevenueGroup(@Body() data: CreateRevenueGroupDto) {
    return this.financeService.createRevenueGroup(data);
  }

  @Get('analytics/revenue-by-group')
  @ApiOkResponse({ type: RevenueAnalyticsResponseDto })
  getRevenueAnalytics() {
    return this.financeService.getRevenueAnalytics();
  }
}
