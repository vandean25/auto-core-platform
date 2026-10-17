import type { PrismaClient } from '@prisma/client';

type AnnahmeTemplateSeedClient = Pick<
  PrismaClient,
  'inspectionTemplate' | 'inspectionTemplateItem'
>;

export const ANNAHME_CHECK_TEMPLATE_CODE = 'ANNAHME_CHECK';
export const ANNAHME_CHECK_TEMPLATE_TITLE = 'Annahme-Check';
export const ANNAHME_CHECK_TEMPLATE_VERSION = 1;

const ANNAHME_TEMPLATE_ITEMS = [
  { code: 'KEYS_COMPLETE', label: 'Schlüssel vollständig' },
  { code: 'SERVICE_BOOK', label: 'Serviceheft / Bordmappe' },
  { code: 'REGISTRATION_DOC', label: 'Zulassungsbescheinigung' },
  { code: 'WARNING_TRIANGLE', label: 'Warndreieck' },
  { code: 'FIRST_AID_KIT', label: 'Verbandskasten' },
  { code: 'SAFETY_VEST', label: 'Warnweste' },
  { code: 'FLOOR_MATS', label: 'Fußmatten dokumentiert' },
  { code: 'PERSONAL_ITEMS', label: 'Persönliche Gegenstände dokumentiert' },
] as const;

export async function seedAnnahmeCheckInspectionTemplate(
  prisma: AnnahmeTemplateSeedClient,
  tenantId: string,
) {
  const template = await prisma.inspectionTemplate.upsert({
    where: {
      tenant_id_code_version: {
        tenant_id: tenantId,
        code: ANNAHME_CHECK_TEMPLATE_CODE,
        version: ANNAHME_CHECK_TEMPLATE_VERSION,
      },
    },
    update: {},
    create: {
      tenant_id: tenantId,
      code: ANNAHME_CHECK_TEMPLATE_CODE,
      title: ANNAHME_CHECK_TEMPLATE_TITLE,
      version: ANNAHME_CHECK_TEMPLATE_VERSION,
      is_active: true,
    },
  });

  await Promise.all(
    ANNAHME_TEMPLATE_ITEMS.map((item, index) =>
      prisma.inspectionTemplateItem.upsert({
        where: {
          tenant_id_inspection_template_id_code: {
            tenant_id: tenantId,
            inspection_template_id: template.id,
            code: item.code,
          },
        },
        update: {},
        create: {
          tenant_id: tenantId,
          inspection_template_id: template.id,
          code: item.code,
          label: item.label,
          response_type: 'PASS_FAIL',
          sort_order: index + 1,
          is_required: false,
          is_active: true,
        },
      }),
    ),
  );

  return template;
}
