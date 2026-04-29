import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateVehicleDto {
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
  @Max(2100)
  year!: number;

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

  @ApiProperty({
    type: String,
    format: 'uuid',
    required: false,
    nullable: true,
  })
  @IsUUID()
  @IsOptional()
  customer_id?: string | null;
}
