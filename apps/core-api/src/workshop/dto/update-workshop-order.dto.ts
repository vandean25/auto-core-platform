import { IsOptional, IsString } from 'class-validator';

export class UpdateWorkshopOrderDto {
  @IsString()
  @IsOptional()
  reportedIssue?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
