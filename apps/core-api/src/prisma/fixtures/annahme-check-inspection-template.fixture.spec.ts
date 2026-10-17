import { seedAnnahmeCheckInspectionTemplate } from './annahme-check-inspection-template.fixture.js';

describe('annahme-check-inspection-template.fixture', () => {
  it('upserts one tenant template and its checklist items on every run', async () => {
    const template = { id: 'template-annahme', tenant_id: 'tenant-1' };
    const mockPrisma: any = {
      inspectionTemplate: {
        upsert: jest.fn().mockResolvedValue(template),
      },
      inspectionTemplateItem: {
        upsert: jest.fn().mockImplementation(({ create }) =>
          Promise.resolve(create),
        ),
      },
    };

    await seedAnnahmeCheckInspectionTemplate(mockPrisma, 'tenant-1');
    await seedAnnahmeCheckInspectionTemplate(mockPrisma, 'tenant-1');

    expect(mockPrisma.inspectionTemplate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenant_id_code_version: {
            tenant_id: 'tenant-1',
            code: 'ANNAHME_CHECK',
            version: 1,
          },
        },
      }),
    );
    expect(mockPrisma.inspectionTemplate.upsert).toHaveBeenCalledTimes(2);
    expect(mockPrisma.inspectionTemplateItem.upsert).toHaveBeenCalledTimes(16);
  });
});
