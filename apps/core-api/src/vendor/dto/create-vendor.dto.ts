import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsArray,
  IsInt,
  IsOptional,
} from 'class-validator';

export class CreateVendorDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  accountNumber!: string;

  @IsArray()
  @IsInt({ each: true })
  @IsOptional()
  brandIds?: number[];
}
