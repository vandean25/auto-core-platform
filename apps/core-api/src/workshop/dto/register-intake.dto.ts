import {
  IsString,
  IsNotEmpty,
  IsInt,
  IsOptional,
  ValidateIf,
  Min,
  IsEmail,
} from 'class-validator';

type RegisterIntakeContext = {
  customerId?: string;
};

export class RegisterIntakeDto {
  // Vehicle Details
  @IsString()
  @IsNotEmpty()
  vin!: string;

  @IsString()
  @IsNotEmpty()
  plate!: string;

  @IsString()
  @IsNotEmpty()
  make!: string;

  @IsString()
  @IsNotEmpty()
  model!: string;

  @IsInt()
  @Min(1900)
  year!: number;

  // Customer Linking
  @IsString()
  @IsOptional()
  customerId?: string;

  // New Customer Details (if customerId is missing)
  @ValidateIf((o: RegisterIntakeContext) => !o.customerId)
  @IsString()
  @IsNotEmpty()
  firstName?: string;

  @ValidateIf((o: RegisterIntakeContext) => !o.customerId)
  @IsString()
  @IsNotEmpty()
  lastName?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;
}
