import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsArray,
  IsInt,
  IsOptional,
} from 'class-validator';

export class UpdateVendorDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  name?: string;

  @IsEmail()
  @IsNotEmpty()
  @IsOptional()
  email?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  accountNumber?: string;

  @IsArray()
  @IsInt({ each: true })
  @IsOptional()
  brandIds?: number[];
}
