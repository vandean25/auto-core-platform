import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { LocationType } from '@prisma/client';

export class UpdateLocationDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  name?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  code?: string;

  @IsEnum(LocationType)
  @IsOptional()
  type?: LocationType;

  @IsUUID()
  @IsOptional()
  parentId?: string;
}
