import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class HolderDto {
  @ApiProperty()
  @IsString()
  firstName!: string;

  @ApiProperty()
  @IsString()
  lastName!: string;
}

class Co2Dto {
  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(600)
  value!: number;

  @ApiProperty({ enum: ['WLTP', 'NEDC'] })
  @IsString()
  cycle!: 'WLTP' | 'NEDC';
}

class OwnershipCorrectionDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  expectedCustomerId!: string | null;

  @ApiProperty()
  @IsUUID()
  nextCustomerId!: string;
}

export class ApplyRegistrationIntakeDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  vin!: string | null;

  @ApiProperty()
  @IsString()
  plate!: string;

  @ApiProperty({ type: HolderDto })
  @ValidateNested()
  @Type(() => HolderDto)
  holder!: HolderDto;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  nationalcode!: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  firstRegistration!: string | null;

  @ApiPropertyOptional({ type: Co2Dto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => Co2Dto)
  co2!: Co2Dto | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  make?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1900)
  year?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @ApiPropertyOptional({ type: OwnershipCorrectionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => OwnershipCorrectionDto)
  ownershipCorrection?: OwnershipCorrectionDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  intakeId?: string;
}
