import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDate,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateVehicleSaleDto {
  @ApiProperty()
  @IsUUID()
  vehicle_id!: string;

  @ApiProperty()
  @IsUUID()
  customer_id!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  sale_price!: number;

  @ApiPropertyOptional({ type: String, format: 'date' })
  @Type(() => Date)
  @IsOptional()
  @ValidateIf((_, value) => value != null)
  @IsDate()
  contract_concluded_at?: Date | null;

  @ApiPropertyOptional({ type: String, format: 'date' })
  @Type(() => Date)
  @IsOptional()
  @ValidateIf((_, value) => value != null)
  @IsDate()
  handed_over_at?: Date | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  buyer_is_consumer?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  gewaehrleistung_shortened_negotiated?: boolean;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  gewaehrleistung_note?: string | null;

  @ApiPropertyOptional({
    type: 'integer',
    nullable: true,
    minimum: 1,
    maximum: 120,
    description:
      'Voluntary Garantie duration in months. Omit or null for no Garantie block.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  garantie_months?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  garantie_terms?: string | null;
}
