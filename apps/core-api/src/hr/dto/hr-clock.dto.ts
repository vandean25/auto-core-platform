import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AttendanceEventSource,
  AttendanceEventType,
  EmployeeRole,
} from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export const ATTENDANCE_STATES = [
  'CLOCKED_OUT',
  'CLOCKED_IN',
  'PAUSED',
  'AT_DOCTOR',
] as const;

export type AttendanceState = (typeof ATTENDANCE_STATES)[number];

export class PunchClockDto {
  @ApiProperty({ enum: AttendanceEventType, enumName: 'AttendanceEventType' })
  @IsEnum(AttendanceEventType)
  type!: AttendanceEventType;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  note?: string;
}

export class AttendanceEventResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  employeeId!: string;

  @ApiProperty({ enum: AttendanceEventType, enumName: 'AttendanceEventType' })
  type!: AttendanceEventType;

  @ApiProperty({
    enum: AttendanceEventSource,
    enumName: 'AttendanceEventSource',
  })
  source!: AttendanceEventSource;

  @ApiProperty()
  occurredAt!: Date;

  @ApiPropertyOptional({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty()
  createdAt!: Date;
}

export class ClockResponseDto {
  @ApiProperty({
    enum: ATTENDANCE_STATES,
    enumName: 'AttendanceState',
  })
  state!: AttendanceState;

  @ApiPropertyOptional({ type: AttendanceEventResponseDto, nullable: true })
  lastEvent!: AttendanceEventResponseDto | null;

  @ApiProperty({ type: [AttendanceEventResponseDto] })
  todayEvents!: AttendanceEventResponseDto[];
}

export class PunchResponseDto {
  @ApiProperty({
    enum: ATTENDANCE_STATES,
    enumName: 'AttendanceState',
  })
  state!: AttendanceState;

  @ApiProperty({ type: AttendanceEventResponseDto })
  event!: AttendanceEventResponseDto;
}

export class HrMeEmployeeDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: EmployeeRole, enumName: 'EmployeeRole' })
  role!: EmployeeRole;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  hiredOn!: string | null;

  @ApiProperty()
  annualLeaveDays!: number;
}

export class HrMeResponseDto {
  @ApiProperty({ type: HrMeEmployeeDto })
  employee!: HrMeEmployeeDto;

  @ApiProperty({
    enum: ATTENDANCE_STATES,
    enumName: 'AttendanceState',
  })
  clockState!: AttendanceState;

  @ApiProperty()
  remainingLeaveDays!: number;

  @ApiProperty()
  timezone!: string;
}
