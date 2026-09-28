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
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CreateWorkshopHolidayDto,
  ImportWorkshopHolidaysDto,
  ImportWorkshopHolidaysResponseDto,
  ListWorkshopHolidaysQueryDto,
  UpdateWorkshopHolidayDto,
  WorkshopHolidayDto,
  WorkshopHolidayListResponseDto,
} from './dto/workshop-holiday.dto.js';
import { WorkshopHolidayService } from './workshop-holiday.service.js';

@ApiTags('Workshop')
@Controller('workshop/holidays')
export class WorkshopHolidayController {
  constructor(private readonly holidayService: WorkshopHolidayService) {}

  @Get()
  @ApiOperation({ operationId: 'WorkshopController_listHolidays' })
  @ApiOkResponse({ type: WorkshopHolidayListResponseDto })
  listHolidays(@Query() query: ListWorkshopHolidaysQueryDto) {
    return this.holidayService.listHolidays(query.from, query.to);
  }

  @Post()
  @ApiOperation({ operationId: 'WorkshopController_createHoliday' })
  @ApiCreatedResponse({ type: WorkshopHolidayDto })
  createHoliday(@Body() dto: CreateWorkshopHolidayDto) {
    return this.holidayService.createHoliday(dto);
  }

  @Post('import')
  @ApiOperation({ operationId: 'WorkshopController_importHolidays' })
  @ApiOkResponse({ type: ImportWorkshopHolidaysResponseDto })
  importHolidays(@Body() dto: ImportWorkshopHolidaysDto) {
    return this.holidayService.importPublicHolidays(dto);
  }

  @Patch(':id')
  @ApiOperation({ operationId: 'WorkshopController_updateHoliday' })
  @ApiOkResponse({ type: WorkshopHolidayDto })
  updateHoliday(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkshopHolidayDto,
  ) {
    return this.holidayService.updateHoliday(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ operationId: 'WorkshopController_deleteHoliday' })
  @ApiNoContentResponse()
  deleteHoliday(@Param('id', ParseUUIDPipe) id: string) {
    return this.holidayService.deleteHoliday(id);
  }
}
