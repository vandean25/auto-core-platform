import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AttendanceEventType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class QueryHrAttendanceDto {
  @ApiProperty({ type: String, format: 'date', example: '2026-08-01' })
  @IsDateString()
  from!: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-08-22' })
  @IsDateString()
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
