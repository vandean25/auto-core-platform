import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength } from 'class-validator';

export class PreviewMeasurementImportDto {
  @ApiProperty()
  @IsUUID()
  device_source_id!: string;

  @ApiProperty({ maxLength: 128 })
  @IsString()
  @MaxLength(128)
  native_measurement_reference!: string;
}
