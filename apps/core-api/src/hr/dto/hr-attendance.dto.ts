import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AttendanceEventType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export class QueryHrAttendanceDto {
  @ApiProperty({ type: String, format: 'date', example: '2026-08-01' })
  @IsDateString()
  @Matches(DATE_ONLY_RE, {
    message: 'from must be a date string in YYYY-MM-DD format',
  })
  from!: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-08-22' })
  @IsDateString()
  @Matches(DATE_ONLY_RE, {
    message: 'to must be a date string in YYYY-MM-DD format',
  })
  to!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;
}

export class CreateHrAttendanceDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  employeeId!: string;

  @ApiProperty({ enum: AttendanceEventType, enumName: 'AttendanceEventType' })
  @IsEnum(AttendanceEventType)
  type!: AttendanceEventType;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  note?: string;
}
