import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Length, Min } from 'class-validator';

export class ApplyInspectionImportDto {
  @ApiProperty({ description: 'Reviewed preview fingerprint (64-char hex)' })
  @IsString()
  @Length(64, 64)
  fingerprint!: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  version!: number;
}
