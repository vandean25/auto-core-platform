import { Test, TestingModule } from '@nestjs/testing';
import { CatalogController } from './catalog.controller';
import { CatalogExternalService } from './catalog-external.service';
import { CatalogService } from './catalog.service';

const SWAGGER_API_RESPONSE = 'swagger/apiResponse';

describe('CatalogController', () => {
  let controller: CatalogController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CatalogController],
      providers: [
        { provide: CatalogService, useValue: {} },
        { provide: CatalogExternalService, useValue: {} },
      ],
    }).compile();

    controller = module.get(CatalogController);
  });

  it('documents external search unauthorized and conflict responses', () => {
    const responses = Reflect.getMetadata(
      SWAGGER_API_RESPONSE,
      controller.externalSearch,
    ) as Record<string, unknown>;

    expect(responses?.['200']).toBeDefined();
    expect(responses?.['401']).toBeDefined();
    expect(responses?.['409']).toBeDefined();
  });
});
