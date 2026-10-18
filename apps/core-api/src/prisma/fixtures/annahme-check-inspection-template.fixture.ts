import type { PrismaClient } from '@prisma/client';
import { loadSeedMasterCopy } from './seed-master-copy.js';
import type { InspectionTemplateSeedOptions } from './inspection-template-seed.options.js';

type AnnahmeTemplateSeedClient = Pick<
  PrismaClient,
  'inspectionTemplate' | 'inspectionTemplateItem'
>;

export const ANNAHME_CHECK_TEMPLATE_CODE = 'ANNAHME_CHECK';
export const ANNAHME_CHECK_TEMPLATE_TITLE =
  loadSeedMasterCopy('de').annahme.title;
export const ANNAHME_CHECK_TEMPLATE_VERSION = 1;

const ANNAHME_ITEM_CODES = [
  'KEYS_COMPLETE',
  'SERVICE_BOOK',
  'REGISTRATION_DOC',
  'WARNING_TRIANGLE',
  'FIRST_AID_KIT',
  'SAFETY_VEST',
  'FLOOR_MATS',
  'PERSONAL_ITEMS',
] as const;

export async function seedAnnahmeCheckInspectionTemplate(
  prisma: AnnahmeTemplateSeedClient,
  tenantId: string,
  options: InspectionTemplateSeedOptions = {},
) {
  const language = options.language ?? 'de';
  const copy = loadSeedMasterCopy(language);
  const refresh = options.refreshLocalizedCopy === true;
  const template = await prisma.inspectionTemplate.upsert({
    where: {
      tenant_id_code_version: {
        tenant_id: tenantId,
        code: ANNAHME_CHECK_TEMPLATE_CODE,
        version: ANNAHME_CHECK_TEMPLATE_VERSION,
      },
    },
    update: refresh ? { title: copy.annahme.title } : {},
    create: {
      tenant_id: tenantId,
      code: ANNAHME_CHECK_TEMPLATE_CODE,
      title: copy.annahme.title,
      version: ANNAHME_CHECK_TEMPLATE_VERSION,
      is_active: true,
    },
  });

  await Promise.all(
    ANNAHME_ITEM_CODES.map((code, index) =>
      prisma.inspectionTemplateItem.upsert({
        where: {
          tenant_id_inspection_template_id_code: {
            tenant_id: tenantId,
            inspection_template_id: template.id,
            code,
          },
        },
        update: refresh ? { label: copy.annahme.items[code] } : {},
        create: {
          tenant_id: tenantId,
          inspection_template_id: template.id,
          code,
          label: copy.annahme.items[code],
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
