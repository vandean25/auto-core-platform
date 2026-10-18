import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsUUID } from 'class-validator';
import { DocumentBrandExpectedRevisionField } from './document-branding-revision.fields.js';

export class SaveDocumentBrandDraftDto extends DocumentBrandExpectedRevisionField {
  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  theme!: Record<string, unknown>;

  @ApiProperty({ format: 'uuid', required: false })
  @IsOptional()
  @IsUUID()
  extractionId?: string;
}

export class SaveDocumentBrandDraftSourceDto extends DocumentBrandExpectedRevisionField {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  sourceAssetId!: string;
}

export class ExpectedDocumentBrandRevisionDto extends DocumentBrandExpectedRevisionField {}

export class CreateDocumentBrandExtractionDto extends DocumentBrandExpectedRevisionField {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  sourceAssetId!: string;
}

export class DocumentBrandPreviewDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  theme!: Record<string, unknown>;

  @ApiProperty({ enum: ['AT_STANDARD', 'DE_STANDARD'] })
  @IsIn(['AT_STANDARD', 'DE_STANDARD'])
  sample!: 'AT_STANDARD' | 'DE_STANDARD';
}
