import { IsString, IsNotEmpty, IsEnum, IsOptional, IsUrl, ValidateIf } from 'class-validator';
import { BrandType } from '@prisma/client';

export class CreateBrandDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(BrandType)
  @IsNotEmpty()
  type: BrandType;

  @IsOptional()
  @ValidateIf((o) => o.logoUrl !== '' && o.logoUrl !== null && o.logoUrl !== undefined)
  @IsUrl()
  logoUrl?: string;
}

export class UpdateBrandDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(BrandType)
  type?: BrandType;

  @IsOptional()
  @ValidateIf((o) => o.logoUrl !== '' && o.logoUrl !== null && o.logoUrl !== undefined)
  @IsUrl()
  logoUrl?: string;
}
