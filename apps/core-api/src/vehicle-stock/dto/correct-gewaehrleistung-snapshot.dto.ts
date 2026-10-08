import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CorrectGewaehrleistungSnapshotDto {
  @ApiProperty({ minLength: 1 })
  @IsString()
  @MinLength(1)
  reason!: string;

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

  @ApiProperty()
  @IsBoolean()
  buyer_is_consumer!: boolean;

  @ApiProperty()
  @IsBoolean()
  gewaehrleistung_shortened_negotiated!: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  gewaehrleistung_note?: string | null;
}
