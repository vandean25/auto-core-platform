import {
  Body,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { MechanicAccessible } from '../common/decorators/mechanic-accessible.decorator';
import {
  CreateHrAttendanceDto,
  QueryHrAttendanceDto,
} from './dto/hr-attendance.dto';
import {
  AttendanceEventResponseDto,
  ClockResponseDto,
  HrMeResponseDto,
  PunchClockDto,
  PunchResponseDto,
} from './dto/hr-clock.dto';
import { HrAttendanceService } from './hr-attendance.service';

@ApiTags('HR')
@Controller('hr')
export class HrController {
  constructor(private readonly attendance: HrAttendanceService) {}

  @Get('me')
  @MechanicAccessible()
  @ApiOperation({
    summary: 'Get current linked employee profile and attendance state',
  })
  @ApiResponse({ status: 200, type: HrMeResponseDto })
  async me(): Promise<HrMeResponseDto> {
    return this.attendance.getMeProfile();
  }

  @Get('me/clock')
  @MechanicAccessible()
  @ApiOperation({
    summary: 'Get current attendance clock state and today events',
  })
  @ApiResponse({ status: 200, type: ClockResponseDto })
  async clock(): Promise<ClockResponseDto> {
    return this.attendance.getMyClock();
  }

  @Post('me/clock')
  @MechanicAccessible()
  @ApiOperation({
    summary: 'Punch attendance clock (Come to work, Pause, Doctor, Go home)',
  })
  @ApiResponse({ status: 201, type: PunchResponseDto })
  async punch(@Body() dto: PunchClockDto): Promise<PunchResponseDto> {
    return this.attendance.punchMe(dto.type, dto.note);
  }

  @Get('attendance')
  @ApiOperation({
    summary:
      'Get team attendance event log for date range (OWNER/ADMIN only, max 31 days)',
  })
  @ApiResponse({ status: 200, type: [AttendanceEventResponseDto] })
  async getAttendance(
    @Query() query: QueryHrAttendanceDto,
  ): Promise<AttendanceEventResponseDto[]> {
    return this.attendance.getAttendance(query);
  }

  @Post('attendance')
  @ApiOperation({
    summary:
      'Punch attendance or create correction for employee (OWNER/ADMIN only)',
  })
  @ApiResponse({ status: 201, type: PunchResponseDto })
  async punchEmployee(
    @Body() dto: CreateHrAttendanceDto,
  ): Promise<PunchResponseDto> {
    return this.attendance.punchEmployee(dto);
  }
}
