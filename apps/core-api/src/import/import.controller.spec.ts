import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ImportEntityType, ImportRowAction } from '@prisma/client';
import { ImportController } from './import.controller.js';
import { ImportService } from './import.service.js';
import { ImportDirectUploadService } from './import-direct-upload.service.js';
import { ImportMappingProfileService } from './import-mapping-profile.service.js';
import { IMPORT_ERROR_CODES } from './import.constants.js';

describe('ImportController', () => {
  let controller: ImportController;

  const mockImportService = {
    createDryRunFromUpload: jest.fn(),
    getJob: jest.fn(),
    listJobRows: jest.fn(),
    downloadErrorRowsCsv: jest.fn(),
    applyJob: jest.fn(),
    applyJobHttp: jest.fn(),
    getTemplate: jest.fn(),
    listEntityTypes: jest.fn(),
  };

  const mockMappingProfileService = {
    listProfiles: jest.fn(),
    createProfile: jest.fn(),
  };

  const mockDirectUploadService = {
    start: jest.fn(),
    finalize: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ImportController],
      providers: [
        { provide: ImportService, useValue: mockImportService },
        {
          provide: ImportMappingProfileService,
          useValue: mockMappingProfileService,
        },
        {
          provide: ImportDirectUploadService,
          useValue: mockDirectUploadService,
        },
      ],
    }).compile();

    controller = module.get<ImportController>(ImportController);
    jest.clearAllMocks();
  });

  describe('createDryRun', () => {
    it('accepts SUPPLIER_PRICE_LIST entity type', async () => {
      const file = {
        buffer: Buffer.from(
          'Lieferanten-Artikelnummer;Beschreibung;Einkaufspreis\nART-1;Filter;10.50',
        ),
        originalname: 'prices.csv',
        size: 100,
      } as Express.Multer.File;

      mockImportService.createDryRunFromUpload.mockResolvedValue({
        id: 'job-1',
      });

      const uploadRequest = {};
      const result = await controller.createDryRun(
        uploadRequest as never,
        file,
        'SUPPLIER_PRICE_LIST',
        'vendor-uuid',
        JSON.stringify({ supplier_article_no: 'Lieferanten-Artikelnummer' }),
        JSON.stringify({ create_new_catalog_items: true }),
      );

      expect(mockImportService.createDryRunFromUpload).toHaveBeenCalledWith({
        uploadRequest,
        file,
        entityType: ImportEntityType.SUPPLIER_PRICE_LIST,
        sourceSystem: 'vendor-uuid',
        mappingJson: { supplier_article_no: 'Lieferanten-Artikelnummer' },
        optionsJson: { create_new_catalog_items: true },
      });
      expect(result).toEqual({ id: 'job-1' });
    });

    it('rejects invalid entity type', async () => {
      const file = {
        buffer: Buffer.from('test'),
        originalname: 'test.csv',
        size: 4,
      } as Express.Multer.File;

      await expect(
        controller.createDryRun(
          {} as never,
          file,
          'UNKNOWN_TYPE',
          'source',
          '{}',
          '{}',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getTemplate', () => {
    it('supports SUPPLIER_PRICE_LIST template', async () => {
      mockImportService.getTemplate.mockReturnValue({
        entity_type: ImportEntityType.SUPPLIER_PRICE_LIST,
        fields: [],
        csv: 'header',
      });

      const result = controller.getTemplate('SUPPLIER_PRICE_LIST');
      expect(mockImportService.getTemplate).toHaveBeenCalledWith(
        ImportEntityType.SUPPLIER_PRICE_LIST,
      );
      expect(result.entity_type).toBe(ImportEntityType.SUPPLIER_PRICE_LIST);
    });
  });

  describe('listEntityTypes', () => {
    it('wraps the registry entries from the service in a data envelope', () => {
      const entries = [
        {
          entity_type: ImportEntityType.CUSTOMER,
          wizard: true,
          required_fields: ['external_id'],
        },
      ];
      mockImportService.listEntityTypes.mockReturnValue(entries);

      expect(controller.listEntityTypes()).toEqual({ data: entries });
      expect(mockImportService.listEntityTypes).toHaveBeenCalledTimes(1);
    });
  });

  describe('apply', () => {
    it('forwards apply options body and returns 202 when the job is queued', async () => {
      mockImportService.applyJobHttp.mockResolvedValue({
        httpStatus: 202,
        job: { id: 'job-1', status: 'APPLYING' },
      });
      const res = { status: jest.fn() };

      const body = {
        accept_all_price_jumps: true,
        accepted_row_numbers: [1, 2],
      };

      const result = await controller.apply('job-1', body, res as never);

      expect(mockImportService.applyJobHttp).toHaveBeenCalledWith(
        'job-1',
        body,
      );
      expect(res.status).toHaveBeenCalledWith(202);
      expect(result).toEqual({ id: 'job-1', status: 'APPLYING' });
    });

    it('returns 200 when an applied job has nothing left to retry', async () => {
      mockImportService.applyJobHttp.mockResolvedValue({
        httpStatus: 200,
        job: { id: 'job-1', status: 'APPLIED' },
      });
      const res = { status: jest.fn() };

      const result = await controller.apply('job-1', undefined, res as never);

      expect(mockImportService.applyJobHttp).toHaveBeenCalledWith(
        'job-1',
        undefined,
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(result).toEqual({ id: 'job-1', status: 'APPLIED' });
    });
  });

  describe('direct upload', () => {
    it('starts a signed upload for the request body', async () => {
      mockDirectUploadService.start.mockResolvedValue({
        upload_id: 'upload-1',
      });
      const body = { fileName: 'big.csv', size: 64 * 1024 * 1024 };

      await expect(controller.startDirectUpload(body)).resolves.toEqual({
        upload_id: 'upload-1',
      });
      expect(mockDirectUploadService.start).toHaveBeenCalledWith(body);
    });

    it('finalizes a staged upload with trimmed source system and options', async () => {
      mockDirectUploadService.finalize.mockResolvedValue({ id: 'job-1' });
      const body = {
        fileName: 'big.csv',
        size: 64 * 1024 * 1024,
        entityType: ImportEntityType.CUSTOMER,
        sourceSystem: '  legacy-dms  ',
        mapping: { external_id: 'Kunden-Nr' },
        options: { update_existing: true },
      };

      await expect(
        controller.finalizeDirectUpload('upload-1', body),
      ).resolves.toEqual({ id: 'job-1' });
      expect(mockDirectUploadService.finalize).toHaveBeenCalledWith({
        uploadId: 'upload-1',
        fileName: 'big.csv',
        size: 64 * 1024 * 1024,
        entityType: ImportEntityType.CUSTOMER,
        sourceSystem: 'legacy-dms',
        mapping: { external_id: 'Kunden-Nr' },
        options: { update_existing: true },
      });
    });
  });
});
