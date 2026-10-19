import {
  Body,
  Controller,
  Get,
  Logger,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  AssignBoardDto,
  BoardActiveResponseDto,
  RegisterIntakeDto,
  WorkshopResourcesResponseDto,
  WorkshopSearchResponseDto,
} from './dto/index.js';
import { VehicleListItemDto } from '../vehicle/dto/vehicle-response.dto.js';
import * as board from './workshop-board.service.js';
import * as intake from './workshop-intake.service.js';

@ApiTags('Workshop')
@Controller('workshop')
export class WorkshopController {
  private readonly logger = new Logger(WorkshopController.name);

  constructor(
    private readonly boardService: board.WorkshopBoardService,
    private readonly intakeService: intake.WorkshopIntakeService,
  ) {
    this.logAction('initialized');
  }

  private logAction(action: string) {
    this.logger.debug(action);
  }

  @Post('register')
  @ApiCreatedResponse({ type: VehicleListItemDto })
  register(@Body() dto: RegisterIntakeDto) {
    this.logAction('register');
    return this.intakeService.register(dto);
  }

  @Get('search')
  @ApiOkResponse({ type: WorkshopSearchResponseDto })
  search(@Query('q') q: string) {
    this.logAction('search');
    return this.intakeService.search(q);
  }

  @Get('resources')
  @ApiOkResponse({ type: WorkshopResourcesResponseDto })
  getBoardResources() {
    this.logAction('getBoardResources');
    return this.boardService.getBoardResources();
  }

  @Get('board/active')
  @ApiOkResponse({ type: BoardActiveResponseDto })
  getBoardActive() {
    this.logAction('getBoardActive');
    return this.boardService.getBoardActive();
  }

  @Patch('board/assign')
  @ApiOkResponse({ description: 'Updated workshop order assignment.' })
  assignBoard(@Body() dto: AssignBoardDto) {
    this.logAction('assignBoard');
    return this.boardService.assignBoard(dto);
  }
}
