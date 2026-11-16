import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { SavedViewVisibility } from '@prisma/client';

export class ListSavedViewsQueryDto {
  @ApiPropertyOptional({
    description:
      'Optional list path filter (e.g. /sales/invoices). Omit to return all permitted views.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  listPath?: string;
}

export class CreateSavedViewDto {
  @ApiProperty({ example: '/sales/invoices' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  listPath!: string;

  @ApiProperty({ example: 'Offene Rechnungen' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @ApiProperty({ example: '/sales/invoices?filter_status=ISSUED' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  href!: string;

  @ApiPropertyOptional({
    enum: SavedViewVisibility,
    enumName: 'SavedViewVisibility',
    default: SavedViewVisibility.PERSONAL,
  })
  @IsOptional()
  @IsEnum(SavedViewVisibility)
  visibility?: SavedViewVisibility;
}

export class UpdateSavedViewDto {
  @ApiPropertyOptional({ example: 'Offene Rechnungen (AT)' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({ example: '/sales/invoices?filter_status=OVERDUE' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  href?: string;

  @ApiPropertyOptional({
    enum: SavedViewVisibility,
    enumName: 'SavedViewVisibility',
  })
  @IsOptional()
  @IsEnum(SavedViewVisibility)
  visibility?: SavedViewVisibility;

  @ApiProperty({ example: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class DeleteSavedViewQueryDto {
  @ApiProperty({ example: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

export class CopySavedViewDto {
  @ApiPropertyOptional({ example: 'Kopie: Offene Rechnungen' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;
}

export class SavedViewDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  listPath!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  href!: string;

  @ApiProperty({ enum: SavedViewVisibility, enumName: 'SavedViewVisibility' })
  visibility!: SavedViewVisibility;

  @ApiProperty({ type: String, nullable: true })
  ownerUserId!: string | null;

  @ApiProperty()
  version!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class SavedViewsListResponseDto {
  @ApiProperty({ type: [SavedViewDto] })
  data!: SavedViewDto[];
}
