import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateDocumentBrandExtractionDto,
  DocumentBrandPreviewDto,
  ExpectedDocumentBrandRevisionDto,
  SaveDocumentBrandDraftDto,
  SaveDocumentBrandDraftSourceDto,
} from './document-branding.dto.js';

describe('document branding request DTOs', () => {
  it('accepts a complete manual draft payload', async () => {
    const dto = plainToInstance(SaveDocumentBrandDraftDto, {
      expectedRevision: 2,
      theme: { schemaVersion: 1 },
      extractionId: '7bead330-4c1b-4b01-9ad5-c2db61946651',
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('rejects a negative expected revision on draft save', async () => {
    const dto = plainToInstance(SaveDocumentBrandDraftDto, {
      expectedRevision: -1,
      theme: {},
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'expectedRevision')).toBe(
      true,
    );
  });

  it('requires a source asset id when attaching draft letterhead', async () => {
    const dto = plainToInstance(SaveDocumentBrandDraftSourceDto, {
      expectedRevision: 0,
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'sourceAssetId')).toBe(
      true,
    );
  });

  it('accepts revision-only confirm and reset bodies', async () => {
    const dto = plainToInstance(ExpectedDocumentBrandRevisionDto, {
      expectedRevision: 0,
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('accepts extraction create payloads with revision and source asset', async () => {
    const dto = plainToInstance(CreateDocumentBrandExtractionDto, {
      sourceAssetId: '7bead330-4c1b-4b01-9ad5-c2db61946651',
      expectedRevision: 1,
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('rejects preview samples outside the supported set', async () => {
    const dto = plainToInstance(DocumentBrandPreviewDto, {
      theme: {},
      sample: 'US_STANDARD',
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'sample')).toBe(true);
  });
});
