import { IsString, IsNotEmpty, IsEnum, IsOptional, IsUrl } from 'class-validator';
import { BrandType } from '@prisma/client';

export class CreateBrandDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(BrandType)
  @IsNotEmpty()
  type: BrandType;

  @IsOptional()
  @IsString()
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
  @IsString()
  @IsUrl()
  logoUrl?: string;
}
