import { ApiProperty } from '@nestjs/swagger';

export class StartDirectImportUploadResponseDto {
  @ApiProperty()
  upload_id!: string;

  @ApiProperty({ description: 'Signed V4 resumable upload initiation URL' })
  upload_url!: string;

  @ApiProperty({ enum: ['POST'] })
  method!: 'POST';

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'Headers required on the signed initiation POST',
  })
  headers!: Record<string, string>;

  @ApiProperty()
  content_type!: string;

  @ApiProperty({
    description:
      'Declared size cap; the server re-checks the object at finalize',
  })
  max_bytes!: number;

  @ApiProperty()
  expires_at!: string;
}
