import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EmployeeRole, LeaveRequestStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateMyLeaveDto {
  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-09-01',
    description: 'Start date of leave (inclusive, YYYY-MM-DD)',
  })
  @IsDateString({ strict: true })
  startOn!: string;

  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-09-05',
    description: 'End date of leave (inclusive, YYYY-MM-DD)',
  })
  @IsDateString({ strict: true })
  endOn!: string;

  @ApiPropertyOptional({
    type: String,
    maxLength: 500,
    example: 'Summer vacation',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CreateEmployeeLeaveDto extends CreateMyLeaveDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    example: 'd3b07384-d113-4a0b-8d02-861036f32e92',
    description: 'Employee ID to book leave for (OWNER/ADMIN only)',
  })
  @IsUUID()
  employeeId!: string;
}

export class UpdateLeaveRequestDto {
  @ApiPropertyOptional({
    type: String,
    format: 'date',
    example: '2026-09-02',
    description: 'New start date (inclusive, YYYY-MM-DD)',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  startOn?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    example: '2026-09-06',
    description: 'New end date (inclusive, YYYY-MM-DD)',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  endOn?: string;

  @ApiPropertyOptional({
    type: String,
    maxLength: 500,
    example: 'Rescheduled holiday',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class PatchLeaveBalanceDto {
  @ApiProperty({
    type: Number,
    example: 2026,
    description: 'Calendar year for the balance',
  })
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @ApiPropertyOptional({
    type: Number,
    minimum: 0,
    maximum: 365,
    example: 25,
    description: 'Annual leave allowance days for this year',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  allowanceDays?: number;

  @ApiPropertyOptional({
    type: Number,
    minimum: 0,
    maximum: 365,
    example: 3,
    description: 'Carryover days from previous years',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  carryoverDays?: number;
}

export class QueryHrLeaveDto {
  @ApiPropertyOptional({
    type: String,
    format: 'date',
    example: '2026-08-01',
    description: 'Filter leave overlapping on/after date',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    example: '2026-08-31',
    description: 'Filter leave overlapping on/before date',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    description: 'Filter leave for a specific employee',
  })
  @IsOptional()
  @IsUUID()
  employeeId?: string;
}

export class QueryMyLeaveDto {
  @ApiPropertyOptional({
    type: Number,
    example: 2026,
    description: 'Target year (defaults to current year in shop timezone)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  year?: number;
}

export class LeaveRequestEmployeeDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: EmployeeRole })
  role!: EmployeeRole;
}

export class LeaveRequestResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  employeeId!: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-09-01' })
  startOn!: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-09-05' })
  endOn!: string;

  @ApiProperty({ enum: LeaveRequestStatus })
  @IsEnum(LeaveRequestStatus)
  status!: LeaveRequestStatus;

  @ApiProperty({ example: 5 })
  daysCharged!: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  note!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  createdByUserId!: string | null;

  @ApiPropertyOptional({ type: LeaveRequestEmployeeDto })
  employee?: LeaveRequestEmployeeDto;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class MyLeaveResponseDto {
  @ApiProperty({ example: 2026 })
  year!: number;

  @ApiProperty({ example: 25 })
  allowanceDays!: number;

  @ApiProperty({ example: 0 })
  carryoverDays!: number;

  @ApiProperty({ example: 20 })
  remainingDays!: number;

  @ApiProperty({ type: [LeaveRequestResponseDto] })
  bookings!: LeaveRequestResponseDto[];
}

export class LeaveBalanceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  employeeId!: string;

  @ApiProperty({ example: 2026 })
  year!: number;

  @ApiProperty({ example: 25 })
  allowanceDays!: number;

  @ApiProperty({ example: 0 })
  carryoverDays!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
