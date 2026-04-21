import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { BayService } from './bay.service';
import {
  BayDeleteResponseDto,
  BayResponseDto,
  BaysListResponseDto,
  CreateBayDto,
  ListBaysQueryDto,
  UpdateBayDto,
} from './dto/bay.dto';

@ApiTags('bays')
@Controller('bays')
export class BayController {
  constructor(private readonly bayService: BayService) {}

  @Get()
  @ApiOkResponse({ type: BaysListResponseDto })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findAll(@Query() query: ListBaysQueryDto) {
    return this.bayService.findAll(query);
  }

  @Get(':id')
  @ApiOkResponse({ type: BayResponseDto })
  findOne(@Param('id') id: string) {
    return this.bayService.findOne(id);
  }

  @Post()
  @ApiCreatedResponse({ type: BayResponseDto })
  @ApiConflictResponse({ description: 'Bay name already exists' })
  create(@Body() dto: CreateBayDto) {
    return this.bayService.create(dto);
  }

  @Patch(':id')
  @ApiOkResponse({ type: BayResponseDto })
  @ApiConflictResponse({ description: 'Bay name already exists' })
  update(@Param('id') id: string, @Body() dto: UpdateBayDto) {
    return this.bayService.update(id, dto);
  }

  @Delete(':id')
  @ApiOkResponse({ type: BayDeleteResponseDto })
  @ApiConflictResponse({ description: 'Bay is referenced by workshop orders' })
  remove(@Param('id') id: string) {
    return this.bayService.remove(id);
  }
}
