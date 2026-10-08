export type GewaehrleistungRuleSetId =
  'at-used-vehicle-vgg-2022-v1' | 'at-used-vehicle-vgg-2026-10-v2';

export type GewaehrleistungRuleSet = Readonly<{
  id: GewaehrleistungRuleSetId;
  validFrom: string;
  sourceUrl: string;
  retrievedOn: string;
  additionalSourceUrls: readonly string[];
  scopeNote: string;
  basePeriodYears: number;
  shortenedPeriodYears: number;
  presumptionPeriodYears: number;
  minimumVehicleAgeYears: number;
}>;

export const GEWAEHRLEISTUNG_RULE_SETS: readonly GewaehrleistungRuleSet[] =
  Object.freeze([
    Object.freeze({
      id: 'at-used-vehicle-vgg-2022-v1',
      validFrom: '2022-01-01',
      sourceUrl: 'https://www.ris.bka.gv.at/eli/bgbl/I/2021/175',
      retrievedOn: '2026-10-08',
      additionalSourceUrls: Object.freeze([
        'https://www.wko.at/handel/fahrzeughandel/verkauf-von-gebrauchtwagen',
      ]),
      scopeNote:
        'Basisfrist ab Übergabe; spätere Verlängerungen sind nicht abgebildet.',
      basePeriodYears: 2,
      shortenedPeriodYears: 1,
      presumptionPeriodYears: 1,
      minimumVehicleAgeYears: 1,
    }),
    Object.freeze({
      id: 'at-used-vehicle-vgg-2026-10-v2',
      validFrom: '2026-10-01',
      sourceUrl:
        'https://www.ris.bka.gv.at/Dokumente/BgblAuth/BGBLA_2026_I_60/BGBLA_2026_I_60.html',
      retrievedOn: '2026-10-08',
      additionalSourceUrls: Object.freeze([
        'https://www.ris.bka.gv.at/eli/bgbl/I/2021/175',
        'https://www.wko.at/handel/fahrzeughandel/verkauf-von-gebrauchtwagen',
      ]),
      scopeNote:
        'Basisfrist ab Übergabe; eine Verlängerung durch qualifizierte Verbesserung nach VGG §10 Abs. 2a wird nicht berechnet.',
      basePeriodYears: 2,
      shortenedPeriodYears: 1,
      presumptionPeriodYears: 1,
      minimumVehicleAgeYears: 1,
    }),
  ]);

export function resolveGewaehrleistungRuleSet(
  contractConcludedAt: Date,
): GewaehrleistungRuleSet | null {
  const contractDay = contractConcludedAt.toISOString().slice(0, 10);
  return (
    [...GEWAEHRLEISTUNG_RULE_SETS]
      .reverse()
      .find((ruleSet) => contractDay >= ruleSet.validFrom) ?? null
  );
}
