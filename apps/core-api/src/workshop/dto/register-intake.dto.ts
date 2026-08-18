import {
  IsString,
  IsNotEmpty,
  IsInt,
  IsOptional,
  ValidateIf,
  Min,
  IsEmail,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

type RegisterIntakeContext = {
  customerId?: string;
};

export class RegisterIntakeDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  vin!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  plate!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  make!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  model!: string;

  @ApiProperty()
  @IsInt()
  @Min(1900)
  year!: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  customerId?: string;

  @ApiPropertyOptional()
  @ValidateIf((o: RegisterIntakeContext) => !o.customerId)
  @IsString()
  @IsNotEmpty()
  firstName?: string;

  @ApiPropertyOptional()
  @ValidateIf((o: RegisterIntakeContext) => !o.customerId)
  @IsString()
  @IsNotEmpty()
  lastName?: string;

  @ApiPropertyOptional()
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  phone?: string;
}
