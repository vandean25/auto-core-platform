import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class PreviewInspectionImportDto {
  @ApiProperty()
  @IsUUID()
  connection_id!: string;

  @ApiProperty({ maxLength: 128 })
  @IsString()
  @MaxLength(128)
  native_result_reference!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  workshop_order_id?: string;
}
