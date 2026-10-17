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

  @ApiProperty({ type: String, nullable: true, required: false })
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

/** OpenAPI-only schema for multipart check-in media upload. */
export class UploadWorkshopCheckInMediaBodyDto {
  @ApiProperty({ type: 'string', format: 'binary' })
  file!: unknown;

  @ApiProperty({ format: 'uuid' })
  client_upload_id!: string;

  @ApiProperty({ enum: ['CHECK_IN'] })
  purpose!: 'CHECK_IN';

  @ApiProperty({ type: 'integer' })
  expected_revision!: number;
}
