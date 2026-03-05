import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateVehicleDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  make?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  model?: string;

  @ApiProperty({ required: false })
  @IsInt()
  @Min(1900)
  @Max(2100)
  @IsOptional()
  year?: number;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  engine_code?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  vin?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  plate?: string;

  @ApiProperty({ required: false, nullable: true })
  @IsUUID()
  @IsOptional()
  customer_id?: string | null;
}
