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
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { LaborService } from './labor.service';
import { LaborCategoryService } from './labor-category.service';
import {
  CreateLaborCategoryDto,
  UpdateLaborCategoryDto,
} from './dto/labor-category.dto';

@ApiTags('labor')
@Controller('labor')
export class LaborController {
  constructor(
    private readonly laborService: LaborService,
    private readonly laborCategoryService: LaborCategoryService,
  ) {}

  @Get('search')
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
