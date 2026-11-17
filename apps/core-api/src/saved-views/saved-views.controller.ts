import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { MechanicAccessible } from '../common/decorators/mechanic-accessible.decorator.js';
import {
  CopySavedViewDto,
  CreateSavedViewDto,
  DeleteSavedViewQueryDto,
  ListSavedViewsQueryDto,
  SavedViewDto,
  SavedViewsListResponseDto,
  UpdateSavedViewDto,
} from './dto/saved-views.dto.js';
import { SavedViewsService } from './saved-views.service.js';

@ApiTags('saved-views')
@Controller('saved-views')
@MechanicAccessible()
export class SavedViewsController {
  constructor(private readonly savedViewsService: SavedViewsService) {}

  @Get()
  @ApiOkResponse({ type: SavedViewsListResponseDto })
  list(
    @Query() query: ListSavedViewsQueryDto,
  ): Promise<SavedViewsListResponseDto> {
    return this.savedViewsService.list(query.listPath);
  }

  @Post()
  @ApiCreatedResponse({ type: SavedViewDto })
  create(@Body() dto: CreateSavedViewDto): Promise<SavedViewDto> {
    return this.savedViewsService.create(dto);
  }

  @Patch(':id')
  @ApiOkResponse({ type: SavedViewDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSavedViewDto,
  ): Promise<SavedViewDto> {
    return this.savedViewsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: DeleteSavedViewQueryDto,
  ): Promise<void> {
    return this.savedViewsService.remove(id, query.version);
  }

  @Post(':id/copy')
  @ApiCreatedResponse({ type: SavedViewDto })
  copy(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CopySavedViewDto,
  ): Promise<SavedViewDto> {
    return this.savedViewsService.copy(id, dto);
  }
}
