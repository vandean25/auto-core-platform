import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { MarginRuleService } from './margin-rule.service.js';
import { CreateMarginRuleDto } from './dto/create-margin-rule.dto.js';
import { UpdateMarginRuleDto } from './dto/update-margin-rule.dto.js';
import {
  MarginRuleResponseDto,
  PriceJumpThresholdResponseDto,
  UpdatePriceJumpThresholdDto,
} from './dto/margin-rule-response.dto.js';

@ApiTags('margin-rules')
@Controller('margin-rules')
export class MarginRuleController {
  constructor(private readonly marginRuleService: MarginRuleService) {}

  @Get()
  @ApiOperation({
    summary: 'List all margin rules for current tenant ordered by priority',
  })
  @ApiOkResponse({ type: [MarginRuleResponseDto] })
  findAll(): Promise<MarginRuleResponseDto[]> {
    return this.marginRuleService.findAll();
  }

  @Get('threshold')
  @ApiOperation({ summary: 'Get price jump threshold percentage' })
  @ApiOkResponse({ type: PriceJumpThresholdResponseDto })
  getThreshold(): Promise<PriceJumpThresholdResponseDto> {
    return this.marginRuleService.getThreshold();
  }

  @Put('threshold')
  @ApiOperation({
    summary: 'Update price jump threshold percentage (ADMIN/OWNER only)',
  })
  @ApiOkResponse({ type: PriceJumpThresholdResponseDto })
  updateThreshold(
    @Body() dto: UpdatePriceJumpThresholdDto,
  ): Promise<PriceJumpThresholdResponseDto> {
    return this.marginRuleService.updateThreshold(dto);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new margin rule (ADMIN/OWNER only)' })
  @ApiCreatedResponse({ type: MarginRuleResponseDto })
  create(@Body() dto: CreateMarginRuleDto): Promise<MarginRuleResponseDto> {
    return this.marginRuleService.create(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a margin rule (ADMIN/OWNER only)' })
  @ApiOkResponse({ type: MarginRuleResponseDto })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMarginRuleDto,
  ): Promise<MarginRuleResponseDto> {
    return this.marginRuleService.update(id, dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Partially update a margin rule (ADMIN/OWNER only)',
  })
  @ApiOkResponse({ type: MarginRuleResponseDto })
  patch(
    @Param('id') id: string,
    @Body() dto: UpdateMarginRuleDto,
  ): Promise<MarginRuleResponseDto> {
    return this.marginRuleService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a margin rule (ADMIN/OWNER only)' })
  @ApiOkResponse({ description: 'Margin rule deleted successfully' })
  delete(@Param('id') id: string): Promise<{ success: boolean }> {
    return this.marginRuleService.delete(id);
  }
}
