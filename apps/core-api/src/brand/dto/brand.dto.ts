import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUrl,
  ValidateIf,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBrandDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty()
  @IsBoolean()
  isVehicleMake!: boolean;

  @ApiProperty()
  @IsBoolean()
  isPartManufacturer!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf(
    (o: { logoUrl?: string | null }) =>
      o.logoUrl !== '' && o.logoUrl !== null && o.logoUrl !== undefined,
  )
  @IsUrl()
  logoUrl?: string;
}

export class UpdateBrandDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isVehicleMake?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPartManufacturer?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf(
    (o: { logoUrl?: string | null }) =>
      o.logoUrl !== '' && o.logoUrl !== null && o.logoUrl !== undefined,
  )
  @IsUrl()
  logoUrl?: string;
}
