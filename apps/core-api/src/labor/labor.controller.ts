import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { LaborService } from './labor.service';
import { LaborCategoryService } from './labor-category.service';
import {
  CreateLaborCategoryDto,
  UpdateLaborCategoryDto,
} from './dto/labor-category.dto';
import {
  CreateLaborOperationDto,
  LaborOperationResponseDto,
  ListLaborOperationsQueryDto,
  PaginatedLaborOperationsResponseDto,
  SoftDeleteResponseDto,
  UpdateLaborOperationDto,
  LaborOperationSearchResponseDto,
} from './dto/labor-operation.dto';

@ApiTags('labor')
@Controller('labor')
export class LaborController {
  constructor(
    private readonly laborService: LaborService,
    private readonly laborCategoryService: LaborCategoryService,
  ) {}

  @Get('search')
  @ApiOkResponse({ type: LaborOperationSearchResponseDto })
  @ApiQuery({ name: 'q', required: true, schema: { type: 'string' } })
  @ApiQuery({
    name: 'workshopOrderId',
    required: true,
    schema: { type: 'string' },
  })
  search(
    @Query('q') query: string,
    @Query('workshopOrderId') workshopOrderId: string,
  ) {
    return this.laborService.search(query, workshopOrderId);
  }

  // ── Labor Operations ──────────────────────────────────────────────────

  @Get('operations')
  @ApiOkResponse({ type: PaginatedLaborOperationsResponseDto })
  listOperations(@Query() query: ListLaborOperationsQueryDto) {
    return this.laborService.findAll(query);
  }

  @Get('operations/:id')
  @ApiOkResponse({ type: LaborOperationResponseDto })
  getOperation(@Param('id') id: string) {
    return this.laborService.findOne(id);
  }

  @Post('operations')
  @ApiCreatedResponse({ type: LaborOperationResponseDto })
  createOperation(@Body() dto: CreateLaborOperationDto) {
    return this.laborService.create(dto);
  }

  @Patch('operations/:id')
  @ApiOkResponse({ type: LaborOperationResponseDto })
  updateOperation(
    @Param('id') id: string,
    @Body() dto: UpdateLaborOperationDto,
  ) {
    return this.laborService.update(id, dto);
  }

  @Delete('operations/:id')
  @ApiOkResponse({ type: SoftDeleteResponseDto })
  removeOperation(@Param('id') id: string) {
    return this.laborService.softDelete(id);
  }

  // ── Labor Categories ──────────────────────────────────────────────────

  @Get('categories')
  getCategories() {
    return this.laborCategoryService.findAll();
  }

  @Post('categories')
  createCategory(@Body() dto: CreateLaborCategoryDto) {
    return this.laborCategoryService.create(dto);
  }

  @Patch('categories/:id')
  updateCategory(@Param('id') id: string, @Body() dto: UpdateLaborCategoryDto) {
    return this.laborCategoryService.update(id, dto);
  }

  @Delete('categories/:id')
  removeCategory(@Param('id') id: string) {
    return this.laborCategoryService.remove(id);
  }
}
