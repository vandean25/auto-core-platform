import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import { HH_MM } from '../workshop-hours.defaults';
import { WorkshopHolidaySource } from '@prisma/client';

export class WorkshopHolidayDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ example: '2026-12-24' })
  observedOn!: string;

  @ApiProperty()
  repeatsAnnually!: boolean;

  @ApiProperty()
  isClosed!: boolean;

  @ApiPropertyOptional({ nullable: true, type: String })
  openTime!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  closeTime!: string | null;

  @ApiProperty({ enum: WorkshopHolidaySource, enumName: 'WorkshopHolidaySource' })
  source!: WorkshopHolidaySource;
}

export class CreateWorkshopHolidayDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ example: '2026-12-24' })
  @IsDateString()
  observedOn!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  repeatsAnnually?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isClosed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(HH_MM)
  openTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(HH_MM)
  closeTime?: string;
}

export class UpdateWorkshopHolidayDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional({ example: '2026-12-24' })
  @IsOptional()
  @IsDateString()
  observedOn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  repeatsAnnually?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isClosed?: boolean;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @Matches(HH_MM)
  openTime?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @Matches(HH_MM)
  closeTime?: string | null;
}

export class WorkshopHolidayListResponseDto {
  @ApiProperty({ type: [WorkshopHolidayDto] })
  data!: WorkshopHolidayDto[];
}

export class ImportWorkshopHolidaysDto {
  @ApiPropertyOptional({ example: 'AT' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2}$/)
  countryIsoCode?: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  subdivisionCode?: string | null;
}

export class ImportWorkshopHolidaysResponseDto {
  @ApiProperty()
  imported!: number;

  @ApiProperty()
  skipped!: number;

  @ApiProperty()
  yearFrom!: number;

  @ApiProperty()
  yearTo!: number;
}
