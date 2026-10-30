import type { components } from '@/api/generated/openapi'

export const measurement: components['schemas']['TyreMeasurementResponseDto'] = {
  id: 'measurement-1', siteId: 'site-1', vehicleId: 'vehicle-1',
  workshopOrderId: 'order-1', checkInId: 'check-in-1', tyreSetId: null,
  tyreSetEventId: null, measuredAt: '2026-10-29T12:00:00Z', measuredBy: null,
  measuredByName: 'Pilot customer', country: 'AT', weightClass: 'UP_TO_3500_KG',
  weightClassSource: 'CAPTURE', source: 'CAPTURE', sourceRef: null,
  worstStatus: 'RECOMMENDED', createdAt: '2026-10-29T12:00:00Z',
  wheels: (['FL', 'FR', 'RL', 'RR'] as const).map((position) => ({
    id: position, position, treadInnerMm: 4, treadMiddleMm: 3.5, treadOuterMm: 4.5,
    season: 'SUMMER', construction: 'RADIAL', winterMarking: 'NONE',
    brand: 'Example', model: 'Road', size: '205/55 R16', dot: '1220', mediaId: null,
    evaluation: {
      version: 1, rulesVersion: 'AT_DE_2026_10', country: 'AT',
      evaluatedAt: '2026-10-29T12:00:00Z', weightClass: 'UP_TO_3500_KG',
      state: 'EVALUATED', status: 'RECOMMENDED',
      reasonCodes: ['TREAD_REPLACEMENT_RECOMMENDED'], minimumTreadMm: 3.5,
      thresholds: { legalMinimumMm: 1.6, recommendedBelowMm: 4, ordinaryMinimumMm: 1.6 },
      ageRecommendations: { conditionCheckFromMonths: 72, replacementFromMonths: 120 },
      dot: { format: 'MODERN', productionWeek: 12, productionYear: 2020,
        productionDate: '2020-03-16', ageMonths: 79, minimumAgeMonths: 79 },
    },
  })),
}
