import type { PrismaClient } from '@prisma/client';
import { loadSeedMasterCopy } from './seed-master-copy.js';
import type { InspectionTemplateSeedOptions } from './inspection-template-seed.options.js';

type PickerlTemplateSeedClient = Pick<
  PrismaClient,
  'inspectionTemplate' | 'inspectionTemplateItem'
>;

const PICKERL_TEMPLATE_CODE = 'PICKERL_57A_PREP';
const PICKERL_TEMPLATE_VERSION = 1;

const PICKERL_ITEM_CODES = [
  'LIGHTS',
  'BRAKES',
  'TYRES',
  'WIPERS_WASHER',
  'HORN',
  'SEAT_BELTS',
  'EXHAUST_LEAKS',
  'WARNING_TRIANGLE',
  'FIRST_AID_KIT',
  'SAFETY_VEST',
  'VIN_READABLE',
  'PLATE_READABLE',
] as const;

export async function seedPickerlInspectionTemplate(
  prisma: PickerlTemplateSeedClient,
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
        code: PICKERL_TEMPLATE_CODE,
        version: PICKERL_TEMPLATE_VERSION,
      },
    },
    update: refresh ? { title: copy.pickerl.title } : {},
    create: {
      tenant_id: tenantId,
      code: PICKERL_TEMPLATE_CODE,
      title: copy.pickerl.title,
      version: PICKERL_TEMPLATE_VERSION,
      is_active: true,
    },
  });

  await Promise.all(
    PICKERL_ITEM_CODES.map((code, index) =>
      prisma.inspectionTemplateItem.upsert({
        where: {
          tenant_id_inspection_template_id_code: {
            tenant_id: tenantId,
            inspection_template_id: template.id,
            code,
          },
        },
        update: refresh ? { label: copy.pickerl.items[code] } : {},
        create: {
          tenant_id: tenantId,
          inspection_template_id: template.id,
          code,
          label: copy.pickerl.items[code],
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
