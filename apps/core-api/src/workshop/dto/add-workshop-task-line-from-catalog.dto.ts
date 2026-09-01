import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class AddWorkshopTaskLineFromCatalogDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  hitToken!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  laborCategoryId?: string;
}
