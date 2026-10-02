import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { MechanicAccessible } from '../common/decorators/mechanic-accessible.decorator.js';
import {
  CreateLoanerVehicleDto,
  ListLoanerVehiclesQueryDto,
  LoanerAvailabilityQueryDto,
  LoanerAvailabilityResponseDto,
  LoanerVehicleResponseDto,
  UpdateLoanerVehicleDto,
} from './dto/loaner-vehicle.dto.js';
import { LoanerVehiclesService } from './loaner-vehicles.service.js';

@ApiTags('Workshop')
@Controller('workshop/loaner-vehicles')
export class LoanerVehiclesController {
  constructor(private readonly loanerService: LoanerVehiclesService) {}

  @Get()
  @MechanicAccessible()
  @ApiOkResponse({
    schema: {
      properties: {
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/LoanerVehicleResponseDto' },
        },
      },
    },
  })
  list(@Query() query: ListLoanerVehiclesQueryDto) {
    return this.loanerService.listFleet(query);
  }

  @Get('availability')
  @MechanicAccessible()
  @ApiOkResponse({ type: LoanerAvailabilityResponseDto })
  availability(@Query() query: LoanerAvailabilityQueryDto) {
    return this.loanerService.getAvailability(query);
  }

  @Get(':id')
  @MechanicAccessible()
  @ApiOkResponse({ type: LoanerVehicleResponseDto })
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.loanerService.getFleetVehicle(id);
  }

  @Post()
  @ApiCreatedResponse({ type: LoanerVehicleResponseDto })
  @ApiConflictResponse({ description: 'Vehicle already in loaner fleet' })
  create(@Body() dto: CreateLoanerVehicleDto) {
    return this.loanerService.createFleetVehicle(dto);
  }

  @Patch(':id')
  @ApiOkResponse({ type: LoanerVehicleResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLoanerVehicleDto,
  ) {
    return this.loanerService.updateFleetVehicle(id, dto);
  }

  @Delete(':id')
  @ApiOkResponse({
    schema: {
      properties: {
        id: { type: 'string' },
        deleted: { type: 'boolean' },
      },
    },
  })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.loanerService.deleteFleetVehicle(id);
  }
}
