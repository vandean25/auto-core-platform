import { IsString, IsNotEmpty, IsNumber, IsBoolean, IsOptional } from 'class-validator';

export class CreateRevenueGroupDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @IsNotEmpty()
  tax_rate: number;

  @IsString()
  @IsNotEmpty()
  account_number: string;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}
