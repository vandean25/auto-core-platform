import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Length, Min } from 'class-validator';

export class ApplyMeasurementImportDto {
  @ApiProperty({ minLength: 64, maxLength: 64 })
  @IsString()
  @Length(64, 64)
  fingerprint!: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  version!: number;
}
