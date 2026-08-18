import {
  IsInt,
  IsOptional,
  IsString,
  IsDateString,
  Min,
  Max,
  ValidateIf,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

type FinanceSettingsContext = {
  lock_date?: string | null;
};

export class UpdateFinanceSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  fiscal_year_start_month?: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @ValidateIf((o: FinanceSettingsContext) => o.lock_date !== null)
  @IsDateString()
  lock_date?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  next_invoice_number?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  invoice_prefix?: string;
}
