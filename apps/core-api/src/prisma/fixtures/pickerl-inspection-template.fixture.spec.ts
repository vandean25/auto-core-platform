import { seedPickerlInspectionTemplate } from './pickerl-inspection-template.fixture.js';

describe('pickerl-inspection-template.fixture', () => {
  it('upserts one tenant template and its starting checklist items on every run', async () => {
    const template = { id: 'template-1', tenant_id: 'tenant-1' };
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

    await seedPickerlInspectionTemplate(mockPrisma, 'tenant-1');
    await seedPickerlInspectionTemplate(mockPrisma, 'tenant-1');

    expect(mockPrisma.inspectionTemplate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenant_id_code_version: {
            tenant_id: 'tenant-1',
            code: 'PICKERL_57A_PREP',
            version: 1,
          },
        },
      }),
    );
    expect(mockPrisma.inspectionTemplate.upsert).toHaveBeenCalledTimes(2);
    expect(mockPrisma.inspectionTemplateItem.upsert).toHaveBeenCalledTimes(24);
    expect(
      mockPrisma.inspectionTemplateItem.upsert.mock.calls[0][0].create
        .tenant_id,
    ).toBe('tenant-1');
    expect(
      mockPrisma.inspectionTemplateItem.upsert.mock.calls[0][0].create
        .inspection_template_id,
    ).toBe(template.id);
  });
});
