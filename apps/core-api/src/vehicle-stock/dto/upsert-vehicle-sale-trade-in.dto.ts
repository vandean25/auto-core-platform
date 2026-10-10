import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDate,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/** ISO 3779 VIN: 17 characters, no I, O or Q. */
const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

export class UpsertVehicleSaleTradeInDto {
  @ApiProperty({
    description:
      'Trade-in allowance credited to the buyer for their own vehicle (EUR). Greater than zero and not above the sale price.',
    minimum: 0.01,
  })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0.01)
  allowance!: number;

  @ApiProperty({ description: 'VIN of the trade-in vehicle (17 characters).' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(VIN_PATTERN, {
    message: 'vin must be a 17-character VIN without I, O or Q',
  })
  vin!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  make!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  model!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2100)
  year!: number;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  mileage?: number;

  @ApiPropertyOptional({ type: String, format: 'date' })
  @Type(() => Date)
  @IsOptional()
  @IsDate()
  first_registration_date?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  plate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  color?: string;
}
