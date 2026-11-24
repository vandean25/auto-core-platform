import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { CustomFieldsEnabledGuard } from './custom-fields-enabled.guard.js';
import { CustomFieldsService } from './custom-fields.service.js';
import {
  CreateCustomFieldDefinitionDto,
  CustomFieldDefinitionResponseDto,
  ListCustomFieldDefinitionsQueryDto,
  ReorderCustomFieldDefinitionsDto,
  UpdateCustomFieldDefinitionDto,
} from './dto/custom-field.dto.js';

@Controller('custom-fields')
@UseGuards(CustomFieldsEnabledGuard)
export class CustomFieldsController {
  constructor(private readonly customFieldsService: CustomFieldsService) {}

  @Get('definitions')
  @ApiOperation({ summary: 'List custom field definitions for the tenant' })
  @ApiOkResponse({ type: [CustomFieldDefinitionResponseDto] })
  listDefinitions(@Query() query: ListCustomFieldDefinitionsQueryDto) {
    return this.customFieldsService.listDefinitions(
      query.entity,
      query.includeArchived ?? false,
    );
  }

  @Get('definitions/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header(
    'Content-Disposition',
    'attachment; filename="custom-fields-catalogue.csv"',
  )
  @ApiOperation({
    summary: 'Export custom field catalogue CSV for Art. 30(1) record',
  })
  @ApiOkResponse({ schema: { type: 'string' } })
  exportCatalogue() {
    return this.customFieldsService.exportCatalogueCsv();
  }

  @Post('definitions')
  @ApiOperation({ summary: 'Create a custom field definition (OWNER/ADMIN)' })
  @ApiCreatedResponse({ type: CustomFieldDefinitionResponseDto })
  createDefinition(@Body() dto: CreateCustomFieldDefinitionDto) {
    return this.customFieldsService.createDefinition(dto);
  }

  @Patch('definitions/:id')
  @ApiOperation({ summary: 'Update a custom field definition (OWNER/ADMIN)' })
  @ApiOkResponse({ type: CustomFieldDefinitionResponseDto })
  updateDefinition(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomFieldDefinitionDto,
  ) {
    return this.customFieldsService.updateDefinition(id, dto);
  }

  @Post('definitions/reorder')
  @ApiOperation({ summary: 'Reorder custom field definitions (OWNER/ADMIN)' })
  @ApiOkResponse({ type: [CustomFieldDefinitionResponseDto] })
  reorderDefinitions(@Body() dto: ReorderCustomFieldDefinitionsDto) {
    return this.customFieldsService.reorderDefinitions(dto);
  }
}
