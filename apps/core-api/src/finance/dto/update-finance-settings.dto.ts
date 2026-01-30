import { IsInt, IsOptional, IsString, IsDateString, Min, Max, ValidateIf } from 'class-validator';

export class UpdateFinanceSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  fiscal_year_start_month?: number;

  @IsOptional()
  @ValidateIf((o) => o.lock_date !== null)
  @IsDateString()
  lock_date?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  next_invoice_number?: number;

  @IsOptional()
  @IsString()
  invoice_prefix?: string;
}
