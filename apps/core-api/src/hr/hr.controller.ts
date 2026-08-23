import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
import {
  CreateEmployeeLeaveDto,
  CreateMyLeaveDto,
  LeaveBalanceResponseDto,
  LeaveRequestResponseDto,
  MyLeaveResponseDto,
  PatchLeaveBalanceDto,
  QueryHrLeaveDto,
  QueryMyLeaveDto,
  UpdateLeaveRequestDto,
} from './dto/hr-leave.dto';
import { HrAttendanceService } from './hr-attendance.service';
import { HrLeaveService } from './hr-leave.service';

@ApiTags('HR')
@Controller('hr')
export class HrController {
  constructor(
    private readonly attendance: HrAttendanceService,
    private readonly leave: HrLeaveService,
  ) {}

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

  @Get('me/leave')
  @MechanicAccessible()
  @ApiOperation({
    summary: 'Get my leave bookings, allowance, and remaining days for a year',
  })
  @ApiResponse({ status: 200, type: MyLeaveResponseDto })
  async getMyLeave(
    @Query() query: QueryMyLeaveDto,
  ): Promise<MyLeaveResponseDto> {
    return this.leave.getMyLeave(query.year);
  }

  @Post('me/leave')
  @MechanicAccessible()
  @ApiOperation({
    summary: 'Book leave for current linked employee',
  })
  @ApiResponse({ status: 201, type: LeaveRequestResponseDto })
  async createMyLeave(
    @Body() dto: CreateMyLeaveDto,
  ): Promise<LeaveRequestResponseDto> {
    return this.leave.createMyLeave(dto);
  }

  @Post('leave')
  @ApiOperation({
    summary: 'Book leave for an employee (OWNER/ADMIN only)',
  })
  @ApiResponse({ status: 201, type: LeaveRequestResponseDto })
  async createEmployeeLeave(
    @Body() dto: CreateEmployeeLeaveDto,
  ): Promise<LeaveRequestResponseDto> {
    return this.leave.createEmployeeLeave(dto);
  }

  @Post('leave/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @MechanicAccessible()
  @ApiOperation({
    summary: 'Cancel a leave booking (own future leave or OWNER/ADMIN)',
  })
  @ApiResponse({ status: 200, type: LeaveRequestResponseDto })
  async cancelLeave(@Param('id') id: string): Promise<LeaveRequestResponseDto> {
    return this.leave.cancelLeave(id);
  }

  @Get('leave')
  @ApiOperation({
    summary: 'Get team leave bookings for date range (OWNER/ADMIN/SALES)',
  })
  @ApiResponse({ status: 200, type: [LeaveRequestResponseDto] })
  async listTeamLeave(
    @Query() query: QueryHrLeaveDto,
  ): Promise<LeaveRequestResponseDto[]> {
    return this.leave.listTeamLeave(query);
  }

  @Patch('leave/:id')
  @ApiOperation({
    summary: 'Update leave booking dates or note (OWNER/ADMIN only)',
  })
  @ApiResponse({ status: 200, type: LeaveRequestResponseDto })
  async updateLeave(
    @Param('id') id: string,
    @Body() dto: UpdateLeaveRequestDto,
  ): Promise<LeaveRequestResponseDto> {
    return this.leave.updateLeave(id, dto);
  }

  @Patch('employees/:id/leave-balance')
  @ApiOperation({
    summary:
      'Update employee annual leave allowance or carryover days (OWNER/ADMIN only)',
  })
  @ApiResponse({ status: 200, type: LeaveBalanceResponseDto })
  async patchLeaveBalance(
    @Param('id') employeeId: string,
    @Body() dto: PatchLeaveBalanceDto,
  ): Promise<LeaveBalanceResponseDto> {
    return this.leave.patchLeaveBalance(employeeId, dto);
  }
}
