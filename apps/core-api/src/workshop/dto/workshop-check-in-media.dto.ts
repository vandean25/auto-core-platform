import { ApiProperty } from '@nestjs/swagger';
import { WorkshopMediaPurpose } from '@prisma/client';

export class WorkshopCheckInMediaItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['CHECK_IN', 'CHECK_IN_SIGNATURE'] })
  purpose!: WorkshopMediaPurpose;

  @ApiProperty()
  mime_type!: string;

  @ApiProperty()
  size_bytes!: number;

  @ApiProperty({ nullable: true, required: false })
  preview_url?: string | null;

  @ApiProperty({
    enum: ['PENDING', 'READY', 'FAILED'],
    required: false,
  })
  processing_status?: 'PENDING' | 'READY' | 'FAILED';
}

export class WorkshopCheckInMediaListDto {
  @ApiProperty({ type: [WorkshopCheckInMediaItemDto] })
  data!: WorkshopCheckInMediaItemDto[];
}
