import { IsString, IsNotEmpty, IsOptional, IsUrl, ValidateIf, IsBoolean } from 'class-validator';

export class CreateBrandDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsBoolean()
  isVehicleMake: boolean;

  @IsBoolean()
  isPartManufacturer: boolean;

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
  @IsBoolean()
  isVehicleMake?: boolean;

  @IsOptional()
  @IsBoolean()
  isPartManufacturer?: boolean;

  @IsOptional()
  @ValidateIf((o) => o.logoUrl !== '' && o.logoUrl !== null && o.logoUrl !== undefined)
  @IsUrl()
  logoUrl?: string;
}