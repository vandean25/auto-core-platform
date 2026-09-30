import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class SaveDocumentBrandDraftDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  expectedRevision!: number;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  theme!: Record<string, unknown>;

  @ApiProperty({ format: 'uuid', required: false })
  @IsOptional()
  @IsUUID()
  extractionId?: string;
}

export class ExpectedDocumentBrandRevisionDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  expectedRevision!: number;
}

export class CreateDocumentBrandExtractionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  sourceAssetId!: string;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  expectedRevision!: number;
}

export class DocumentBrandPreviewDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  theme!: Record<string, unknown>;

  @ApiProperty({ enum: ['AT_STANDARD', 'DE_STANDARD'] })
  @IsIn(['AT_STANDARD', 'DE_STANDARD'])
  sample!: 'AT_STANDARD' | 'DE_STANDARD';
}

export class DocumentBrandThemeResponseDto {
  @ApiProperty({ enum: [1] })
  schemaVersion!: 1;

  @ApiProperty({ enum: ['standard-v1'] })
  presetId!: 'standard-v1';

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  logoAssetId!: string | null;

  @ApiProperty({ example: '#111827', pattern: '^#[0-9A-F]{6}$' })
  primaryColor!: string;

  @ApiProperty({ example: '#E5E7EB', pattern: '^#[0-9A-F]{6}$' })
  secondaryColor!: string;

  @ApiProperty({ enum: ['acp-sans-v1'] })
  fontId!: 'acp-sans-v1';

  @ApiProperty({ enum: ['none', 'primary', 'secondary'] })
  headerBand!: 'none' | 'primary' | 'secondary';

  @ApiProperty({ enum: ['none', 'primary', 'secondary'] })
  footerBand!: 'none' | 'primary' | 'secondary';

  @ApiProperty({ maxLength: 120 })
  headerText!: string;

  @ApiProperty({ maxLength: 120 })
  footerText!: string;
}

export class DocumentBrandExtractionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    enum: ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DISCARDED'],
  })
  state!: string;

  @ApiProperty({ type: DocumentBrandThemeResponseDto, nullable: true })
  proposal!: DocumentBrandThemeResponseDto | null;

  @ApiProperty({ type: [String] })
  warnings!: string[];

  @ApiProperty({ minimum: 0 })
  baseRevision!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  completedAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  expiresAt!: Date | null;

  @ApiProperty({ type: String, nullable: true })
  failureCode!: string | null;
}

export class DocumentBrandUploadConstraintsDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  maxBytes!: number;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  mimeTypes!: string[];

  @ApiProperty()
  @IsString()
  accept!: string;

  @ApiProperty()
  @IsString()
  requirementLabel!: string;
}

export class DocumentBrandThemeCapabilitiesDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  decorativeTextMaxCodePoints!: number;
}

export class DocumentBrandUploadCapabilitiesDto {
  @ApiProperty({ type: DocumentBrandUploadConstraintsDto })
  @ValidateNested()
  @Type(() => DocumentBrandUploadConstraintsDto)
  logo!: DocumentBrandUploadConstraintsDto;

  @ApiProperty({ type: DocumentBrandUploadConstraintsDto })
  @ValidateNested()
  @Type(() => DocumentBrandUploadConstraintsDto)
  source!: DocumentBrandUploadConstraintsDto;
}

export class DocumentBrandProfileCapabilitiesDto {
  @ApiProperty()
  @IsBoolean()
  extractionAvailable!: boolean;

  @ApiProperty({ type: DocumentBrandThemeCapabilitiesDto })
  @ValidateNested()
  @Type(() => DocumentBrandThemeCapabilitiesDto)
  theme!: DocumentBrandThemeCapabilitiesDto;

  @ApiProperty({ type: DocumentBrandUploadCapabilitiesDto })
  @ValidateNested()
  @Type(() => DocumentBrandUploadCapabilitiesDto)
  uploads!: DocumentBrandUploadCapabilitiesDto;
}

export class DocumentBrandProfileResponseDto {
  @ApiProperty({ minimum: 0 })
  revision!: number;

  @ApiProperty({ minimum: 0 })
  activeRevision!: number;

  @ApiProperty({ type: DocumentBrandThemeResponseDto })
  activeTheme!: DocumentBrandThemeResponseDto;

  @ApiProperty({ type: DocumentBrandThemeResponseDto, nullable: true })
  draftTheme!: DocumentBrandThemeResponseDto | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  confirmedAt!: Date | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  confirmedByUserId!: string | null;

  @ApiProperty({ type: DocumentBrandProfileCapabilitiesDto })
  @ValidateNested()
  @Type(() => DocumentBrandProfileCapabilitiesDto)
  capabilities!: DocumentBrandProfileCapabilitiesDto;
}

export class DocumentBrandAssetResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['SOURCE', 'LOGO'] })
  purpose!: 'SOURCE' | 'LOGO';

  @ApiProperty({
    enum: ['QUARANTINED', 'READY', 'REJECTED', 'DELETING', 'DELETED'],
  })
  state!: string;

  @ApiProperty({ type: String, nullable: true })
  detectedMimeType!: string | null;

  @ApiProperty({ minimum: 0 })
  byteLength!: number;

  @ApiProperty({ type: Number, nullable: true })
  pixelWidth!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  pixelHeight!: number | null;

  @ApiProperty({ type: String, nullable: true })
  failureCode!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  expiresAt!: Date | null;
}

export class DocumentBrandPreviewResponseDto {
  @ApiProperty({ type: String })
  html!: string;

  @ApiProperty({ type: [String] })
  warnings!: string[];

  @ApiProperty({ pattern: '^[a-f0-9]{64}$' })
  themeHash!: string;
}
