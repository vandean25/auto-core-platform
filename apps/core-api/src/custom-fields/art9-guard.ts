import { UnprocessableEntityException } from '@nestjs/common';
import {
  CUSTOM_FIELD_ART9_BLOCKED_CODE,
  CUSTOM_FIELD_ART9_CONFIRMATION_REQUIRED_CODE,
} from './custom-fields.constants.js';

export type Art9CheckStatus = 'OK' | 'WARNING' | 'BLOCKED';

export interface Art9CheckResult {
  status: Art9CheckStatus;
  matchedKeywords: string[];
}

const ART9_BLOCKED_KEYWORDS = [
  'gesundheitszustand',
  'gesundheitsdaten',
  'krankheit',
  'diagnose',
  'behinderung',
  'pflegegrad',
  'impfstatus',
  'schwangerschaft',
  'health_status',
  'health_data',
  'medical_condition',
  'disability',
  'diagnosis',
  'religion',
  'konfession',
  'glaubensbekenntnis',
  'religious_belief',
  'biometrie',
  'biometric',
  'fingerabdruck',
  'fingerprint',
  'dna',
  'genetik',
  'genetic',
  'gewerkschaft',
  'trade_union',
  'union_membership',
  'sexuelle_orientierung',
  'sexual_orientation',
  'ethnische_herkunft',
  'herkunft_ethnisch',
  'ethnic_origin',
  'rasse',
  'politische_meinung',
  'parteizugehoerigkeit',
  'political_opinion',
] as const;

const ART9_WARNING_KEYWORDS = [
  'gesundheit',
  'health',
  'medizin',
  'medical',
  'allergie',
  'allergy',
  'glaube',
  'belief',
  'kirche',
  'church',
  'partei',
  'party',
  'herkunft',
  'origin',
  'orientierung',
  'orientation',
  'blutgruppe',
  'blood_group',
] as const;

function normalizeForArt9(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[\s-]+/g, '_');
}

function findMatchedKeywords(
  candidates: string[],
  keywords: readonly string[],
): string[] {
  const matched = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate) continue;
    for (const kw of keywords) {
      if (candidate.includes(kw)) {
        matched.add(kw);
      }
    }
  }
  return Array.from(matched);
}

export function checkArt9FieldSafety(
  label: string,
  key?: string,
): Art9CheckResult {
  const candidates = [normalizeForArt9(label), key ? normalizeForArt9(key) : ''];

  const blocked = findMatchedKeywords(candidates, ART9_BLOCKED_KEYWORDS);
  if (blocked.length > 0) {
    return { status: 'BLOCKED', matchedKeywords: blocked };
  }

  const warned = findMatchedKeywords(candidates, ART9_WARNING_KEYWORDS);
  if (warned.length > 0) {
    return { status: 'WARNING', matchedKeywords: warned };
  }

  return { status: 'OK', matchedKeywords: [] };
}

export function assertArt9FieldSafety(
  label: string,
  key: string | undefined,
  confirmNoArt9: boolean | undefined,
): void {
  const check = checkArt9FieldSafety(label, key);
  if (check.status === 'BLOCKED') {
    throw new UnprocessableEntityException({
      code: CUSTOM_FIELD_ART9_BLOCKED_CODE,
      message:
        'Field name is blocked because it indicates special-category personal data under GDPR Art. 9.',
      matchedKeywords: check.matchedKeywords,
    });
  }
  if (check.status === 'WARNING' && confirmNoArt9 !== true) {
    throw new UnprocessableEntityException({
      code: CUSTOM_FIELD_ART9_CONFIRMATION_REQUIRED_CODE,
      message:
        'Field name may relate to GDPR Art. 9 special-category data. Explicit confirmation is required that no Art. 9 data will be stored.',
      matchedKeywords: check.matchedKeywords,
    });
  }
}
