import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { HH_MM, SLOT_MINUTES } from '../workshop-hours.defaults';

export class WorkshopOpeningHourDto {
  @ApiProperty({ minimum: 1, maximum: 7 })
  @IsInt()
  @Min(1)
  @Max(7)
  weekday!: number;

  @ApiProperty()
  @IsBoolean()
  isClosed!: boolean;

  @ApiProperty({ example: '07:30' })
  @IsString()
  @Matches(HH_MM)
  openTime!: string;

  @ApiProperty({ example: '17:00' })
  @IsString()
  @Matches(HH_MM)
  closeTime!: string;
}

export class WorkshopSettingsResponseDto {
  @ApiProperty()
  timezone!: string;

  @ApiProperty({ enum: SLOT_MINUTES })
  slotMinutes!: (typeof SLOT_MINUTES)[number];

  @ApiProperty({ example: 'AT' })
  holidayCountryIso!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  holidaySubdivisionCode!: string | null;

  @ApiProperty({ type: [WorkshopOpeningHourDto] })
  openingHours!: WorkshopOpeningHourDto[];
}

export class UpdateWorkshopSettingsDto {
  @ApiProperty({ example: 'Europe/Vienna' })
  @IsString()
  timezone!: string;

  @ApiProperty({ enum: SLOT_MINUTES })
  @IsInt()
  @IsIn([...SLOT_MINUTES])
  slotMinutes!: (typeof SLOT_MINUTES)[number];

  @ApiProperty({ example: 'AT' })
  @IsString()
  @Matches(/^[A-Z]{2}$/)
  holidayCountryIso!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  holidaySubdivisionCode?: string | null;

  @ApiProperty({ type: [WorkshopOpeningHourDto] })
  @IsArray()
  @ArrayMinSize(7)
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => WorkshopOpeningHourDto)
  openingHours!: WorkshopOpeningHourDto[];
}
