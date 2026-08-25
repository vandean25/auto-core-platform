import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class EmployeeWorkScheduleDayDto {
  @ApiProperty({ minimum: 1, maximum: 7, example: 1 })
  @IsInt()
  @Min(1)
  @Max(7)
  weekday!: number;

  @ApiProperty({ example: true })
  @IsBoolean()
  isWorking!: boolean;

  @ApiProperty({ type: String, nullable: true, example: '07:30' })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @Matches(TIME_PATTERN)
  startTime!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '17:00' })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @Matches(TIME_PATTERN)
  endTime!: string | null;

  @ApiProperty({ minimum: 0, example: 0 })
  @IsInt()
  @Min(0)
  breakMinutes!: number;
}

abstract class EmployeeWorkScheduleDaysDto {
  @ApiProperty({
    type: [EmployeeWorkScheduleDayDto],
    minItems: 7,
    maxItems: 7,
  })
  @IsArray()
  @ArrayMinSize(7)
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => EmployeeWorkScheduleDayDto)
  days!: EmployeeWorkScheduleDayDto[];
}

export class CreateEmployeeWorkScheduleDto extends EmployeeWorkScheduleDaysDto {
  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-09-01',
    description: 'First date this schedule version applies.',
  })
  @IsDateString({ strict: true })
  @Matches(DATE_ONLY_PATTERN)
  effectiveFrom!: string;
}

export class UpdateEmployeeWorkScheduleDto extends EmployeeWorkScheduleDaysDto {
  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: true,
    description:
      'Accepted for compatibility but ignored; effectiveFrom is immutable.',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(DATE_ONLY_PATTERN)
  effectiveFrom?: string;
}

export class EmployeeWorkScheduleDayResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ minimum: 1, maximum: 7 })
  weekday!: number;

  @ApiProperty()
  isWorking!: boolean;

  @ApiProperty({ type: String, nullable: true })
  startTime!: string | null;

  @ApiProperty({ type: String, nullable: true })
  endTime!: string | null;

  @ApiProperty()
  breakMinutes!: number;
}

export class EmployeeWorkScheduleVersionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'date' })
  effectiveFrom!: string;

  @ApiProperty({ type: [EmployeeWorkScheduleDayResponseDto] })
  days!: EmployeeWorkScheduleDayResponseDto[];

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class EmployeeWorkScheduleResponseDto {
  @ApiProperty({
    type: EmployeeWorkScheduleVersionResponseDto,
    nullable: true,
  })
  current!: EmployeeWorkScheduleVersionResponseDto | null;

  @ApiProperty({ type: [EmployeeWorkScheduleVersionResponseDto] })
  history!: EmployeeWorkScheduleVersionResponseDto[];
}
