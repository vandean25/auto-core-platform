import { WorkshopTaskStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateWorkshopTaskDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsEnum(WorkshopTaskStatus)
  @IsOptional()
  status?: WorkshopTaskStatus;

  @IsString()
  @IsOptional()
  mechanicNotes?: string;
}
