import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImportEntityType } from '@prisma/client';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import { ImportController } from './import.controller.js';
import { parseImportEntityType } from './import-entity-type.guard.js';
import {
  IMPLEMENTED_IMPORT_ENTITY_TYPES,
  IMPORT_ENTITY_TYPE_REGISTRY,
  createImportHandlers,
  getImportTemplate,
  listImportEntityTypes,
  type ImportHandlerDeps,
} from './import-entity-type.registry.js';

type OpenApiDocument = {
  paths: Record<string, Record<string, any>>;
  components: { schemas: Record<string, any> };
};

const REGISTRY_TYPES = Object.keys(IMPORT_ENTITY_TYPE_REGISTRY).sort();
const NOT_IMPLEMENTED_TYPES = Object.values(ImportEntityType).filter(
  (type) => !REGISTRY_TYPES.includes(type),
);

function readOpenApi(): OpenApiDocument {
  return JSON.parse(
    readFileSync(join(process.cwd(), 'openapi', 'openapi.json'), 'utf8'),
  ) as OpenApiDocument;
}

function readEnumLabels(locale: 'de' | 'en'): Record<string, string> {
  const enums = JSON.parse(
    readFileSync(
      join(process.cwd(), '..', '..', 'locales', locale, 'enums.json'),
      'utf8',
    ),
  ) as { importEntityType: Record<string, string> };
  return enums.importEntityType;
}

function invalidEntityTypeError() {
  return expect.objectContaining({
    response: expect.objectContaining({
      code: IMPORT_ERROR_CODES.INVALID_ENTITY_TYPE,
    }),
  });
}

describe('import entity type registry', () => {
  it('lists every registered type exactly once', () => {
    expect([...IMPLEMENTED_IMPORT_ENTITY_TYPES].sort()).toEqual(REGISTRY_TYPES);
    expect(new Set(IMPLEMENTED_IMPORT_ENTITY_TYPES).size).toBe(
      IMPLEMENTED_IMPORT_ENTITY_TYPES.length,
    );
  });

  it('opens the wizard only for the four wizard types', () => {
    expect(
      listImportEntityTypes()
        .filter((entry) => entry.wizard)
        .map((entry) => entry.entity_type)
        .sort(),
    ).toEqual([
      ImportEntityType.CUSTOMER,
      ImportEntityType.LABOR_OPERATION,
      ImportEntityType.SUPPLIER_PRICE_LIST,
      ImportEntityType.VEHICLE,
    ]);
  });

  it('applies vehicle parties updates first and every other type by row number', () => {
    for (const type of IMPLEMENTED_IMPORT_ENTITY_TYPES) {
      expect(IMPORT_ENTITY_TYPE_REGISTRY[type].applyOrder).toBe(
        type === ImportEntityType.VEHICLE_PARTY ? 'updates_first' : 'row_no',
      );
    }
  });

  it('lists the required template fields of every type', () => {
    for (const entry of listImportEntityTypes()) {
      const template = getImportTemplate(entry.entity_type);
      expect(entry.required_fields).toEqual(
        template.fields
          .filter((field) => field.required)
          .map((field) => field.key),
      );
      expect(entry.required_fields.length).toBeGreaterThan(0);
    }
  });

  describe('guard', () => {
    it.each(REGISTRY_TYPES)('accepts %s', (type) => {
      expect(parseImportEntityType(type)).toBe(type);
    });

    it.each(NOT_IMPLEMENTED_TYPES)('rejects %s', (type) => {
      expect(() => parseImportEntityType(type)).toThrow(
        invalidEntityTypeError(),
      );
    });
  });

  describe('controller parsing', () => {
    const importService = { getTemplate: jest.fn((type: string) => type) };
    const controller = new ImportController(
      importService as never,
      {} as never,
      {} as never,
      {} as never,
    );

    it.each(REGISTRY_TYPES)('accepts %s', (type) => {
      expect(controller.getTemplate(type.toLowerCase())).toBe(type);
    });

    it.each(NOT_IMPLEMENTED_TYPES)('rejects %s', (type) => {
      expect(() => controller.getTemplate(type)).toThrow(
        invalidEntityTypeError(),
      );
    });
  });

  it('builds one handler per registered type', () => {
    const handlers = createImportHandlers({} as ImportHandlerDeps);

    expect(Object.keys(handlers).sort()).toEqual(REGISTRY_TYPES);
    for (const type of IMPLEMENTED_IMPORT_ENTITY_TYPES) {
      expect(handlers[type].entityType).toBe(type);
    }
  });

  it('owns the template of every registered type', () => {
    for (const type of IMPLEMENTED_IMPORT_ENTITY_TYPES) {
      const template = getImportTemplate(type);
      expect(template).toBe(IMPORT_ENTITY_TYPE_REGISTRY[type].template);
      expect(template.entity_type).toBe(type);
      expect(template.csv_header.split(';')).toHaveLength(
        template.fields.length,
      );
    }
  });

  it('has a DE and EN label for every registered type', () => {
    for (const locale of ['de', 'en'] as const) {
      const labels = readEnumLabels(locale);
      expect(Object.keys(labels).sort()).toEqual(REGISTRY_TYPES);
      for (const type of REGISTRY_TYPES) {
        expect(labels[type]?.trim()).toBeTruthy();
      }
    }
  });

  describe('OpenAPI document', () => {
    const openApi = readOpenApi();

    it('limits the upload entity type to the registry', () => {
      const schema =
        openApi.paths['/api/imports'].post.requestBody.content[
          'multipart/form-data'
        ].schema;
      expect([...schema.properties.entityType.enum].sort()).toEqual(
        REGISTRY_TYPES,
      );
    });

    it('limits the mapping profile filter to the registry', () => {
      const parameter = openApi.paths[
        '/api/imports/mapping-profiles'
      ].get.parameters.find(
        (candidate: { name: string }) => candidate.name === 'entityType',
      );
      expect([...parameter.schema.enum].sort()).toEqual(REGISTRY_TYPES);
    });

    it('publishes the registry enum', () => {
      expect(
        [...openApi.components.schemas.ImplementedImportEntityType.enum].sort(),
      ).toEqual(REGISTRY_TYPES);
    });

    it('documents GET /api/imports/entity-types with the registry as example', () => {
      expect(openApi.paths['/api/imports/entity-types']?.get).toBeDefined();
      expect(
        openApi.components.schemas.ImportEntityTypeListResponseDto.properties
          .data.example,
      ).toEqual(listImportEntityTypes());
    });
  });
});
