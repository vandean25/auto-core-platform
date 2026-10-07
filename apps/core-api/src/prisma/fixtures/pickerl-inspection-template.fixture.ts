import type { PrismaClient } from '@prisma/client';

type PickerlTemplateSeedClient = Pick<
  PrismaClient,
  'inspectionTemplate' | 'inspectionTemplateItem'
>;

const PICKERL_TEMPLATE_CODE = 'PICKERL_57A_PREP';
const PICKERL_TEMPLATE_VERSION = 1;

const PICKERL_TEMPLATE_ITEMS = [
  { code: 'LIGHTS', label: 'Beleuchtung' },
  { code: 'BRAKES', label: 'Bremsen' },
  { code: 'TYRES', label: 'Reifen' },
  { code: 'WIPERS_WASHER', label: 'Scheibenwischer und Waschanlage' },
  { code: 'HORN', label: 'Hupe' },
  { code: 'SEAT_BELTS', label: 'Sicherheitsgurte' },
  { code: 'EXHAUST_LEAKS', label: 'Abgasanlage und Undichtigkeiten' },
  { code: 'WARNING_TRIANGLE', label: 'Warndreieck' },
  { code: 'FIRST_AID_KIT', label: 'Erste-Hilfe-Kasten' },
  { code: 'SAFETY_VEST', label: 'Warnweste' },
  { code: 'VIN_READABLE', label: 'Fahrzeug-Identifizierungsnummer lesbar' },
  { code: 'PLATE_READABLE', label: 'Kennzeichen lesbar' },
] as const;

export async function seedPickerlInspectionTemplate(
  prisma: PickerlTemplateSeedClient,
  tenantId: string,
) {
  const template = await prisma.inspectionTemplate.upsert({
    where: {
      tenant_id_code_version: {
        tenant_id: tenantId,
        code: PICKERL_TEMPLATE_CODE,
        version: PICKERL_TEMPLATE_VERSION,
      },
    },
    update: {},
    create: {
      tenant_id: tenantId,
      code: PICKERL_TEMPLATE_CODE,
      title:
        '§57a Vorbereitung — editierbare Start-Checkliste, keine Rechtsliste',
      version: PICKERL_TEMPLATE_VERSION,
      is_active: true,
    },
  });

  await Promise.all(
    PICKERL_TEMPLATE_ITEMS.map((item, index) =>
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
