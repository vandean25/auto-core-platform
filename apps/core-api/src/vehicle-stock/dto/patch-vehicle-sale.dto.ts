import { ApiPropertyOptional } from '@nestjs/swagger';
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

export class PatchVehicleSaleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customer_id?: string;

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  sale_price?: number;

  @ApiPropertyOptional({
    description: 'Target site ID to retarget vehicle sale to (DRAFT only)',
  })
  @IsOptional()
  @IsUUID()
  site_id?: string;

  @ApiPropertyOptional({
    description: 'Alias for site_id',
  })
  @IsOptional()
  @IsUUID()
  siteId?: string;

  @ApiPropertyOptional({
    description: 'Expected site ID for optimistic concurrency checks',
  })
  @IsOptional()
  @IsUUID()
  expectedSiteId?: string;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  @Type(() => Date)
  @IsOptional()
  @ValidateIf((_, value) => value != null)
  @IsDate()
  contract_concluded_at?: Date | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  @Type(() => Date)
  @IsOptional()
  @ValidateIf((_, value) => value != null)
  @IsDate()
  handed_over_at?: Date | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  buyer_is_consumer?: boolean;

  @ApiPropertyOptional()
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
      'Voluntary Garantie duration in months. Null removes the Garantie block (DRAFT only).',
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
