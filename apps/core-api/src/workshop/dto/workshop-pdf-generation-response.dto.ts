import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class WorkshopPdfGenerationResponseDto {
  @ApiProperty()
  message!: string;

  @ApiProperty()
  enqueued!: boolean;

  @ApiPropertyOptional()
  taskId?: string;
}
