import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ImportEntityType, ImportRowAction } from '@prisma/client';
import { ImportController } from './import.controller.js';
import { ImportService } from './import.service.js';
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
    getTemplate: jest.fn(),
  };

  const mockMappingProfileService = {
    listProfiles: jest.fn(),
    createProfile: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ImportController],
      providers: [
        { provide: ImportService, useValue: mockImportService },
        { provide: ImportMappingProfileService, useValue: mockMappingProfileService },
      ],
    }).compile();

    controller = module.get<ImportController>(ImportController);
    jest.clearAllMocks();
  });

  describe('createDryRun', () => {
    it('accepts SUPPLIER_PRICE_LIST entity type', async () => {
      const file = {
        buffer: Buffer.from('Lieferanten-Artikelnummer;Beschreibung;Einkaufspreis\nART-1;Filter;10.50'),
        originalname: 'prices.csv',
        size: 100,
      } as Express.Multer.File;

      mockImportService.createDryRunFromUpload.mockResolvedValue({ id: 'job-1' });

      const result = await controller.createDryRun(
        file,
        'SUPPLIER_PRICE_LIST',
        'vendor-uuid',
        JSON.stringify({ supplier_article_no: 'Lieferanten-Artikelnummer' }),
        JSON.stringify({ create_new_catalog_items: true }),
      );

      expect(mockImportService.createDryRunFromUpload).toHaveBeenCalledWith({
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

  describe('apply', () => {
    it('forwards apply options body to importService.applyJob', async () => {
      mockImportService.applyJob.mockResolvedValue({ id: 'job-1', status: 'APPLIED' });

      const body = {
        accept_all_price_jumps: true,
        accepted_row_numbers: [1, 2],
      };

      const result = await controller.apply('job-1', body);

      expect(mockImportService.applyJob).toHaveBeenCalledWith('job-1', body);
      expect(result).toEqual({ id: 'job-1', status: 'APPLIED' });
    });

    it('handles apply without body', async () => {
      mockImportService.applyJob.mockResolvedValue({ id: 'job-1', status: 'APPLIED' });

      const result = await controller.apply('job-1');

      expect(mockImportService.applyJob).toHaveBeenCalledWith('job-1', undefined);
      expect(result).toEqual({ id: 'job-1', status: 'APPLIED' });
    });
  });
});
