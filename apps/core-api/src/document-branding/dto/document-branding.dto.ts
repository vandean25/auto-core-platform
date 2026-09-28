import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsObject, Min } from 'class-validator';

export class SaveDocumentBrandDraftDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  expectedRevision!: number;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  theme!: Record<string, unknown>;
}

export class ExpectedDocumentBrandRevisionDto {
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

  @ApiProperty({
    type: 'object',
    properties: { extractionAvailable: { type: 'boolean', example: false } },
  })
  capabilities!: { extractionAvailable: false };
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
