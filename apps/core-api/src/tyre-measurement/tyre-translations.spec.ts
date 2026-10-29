import { readFileSync } from 'node:fs';
import type {
  TyreEvaluation,
  TyreReasonCode,
  TyreStatus,
} from './tyre-evaluation.js';

const translatedText: unknown = expect.stringMatching(/[a-zäöüß]/);
const reasonLabels: Record<TyreReasonCode, unknown> = {
  TREAD_BELOW_LEGAL_MINIMUM: translatedText,
  AT_WINTER_TREAD_INSUFFICIENT: translatedText,
  TREAD_REPLACEMENT_RECOMMENDED: translatedText,
  DE_ALPINE_MISSING: translatedText,
  AT_WINTER_RULE_NOTICE: translatedText,
  DOT_CONDITION_CHECK_RECOMMENDED: translatedText,
  DOT_REPLACEMENT_RECOMMENDED: translatedText,
  DOT_LEGACY_OVER_20_YEARS: translatedText,
  UNSUPPORTED_COUNTRY: translatedText,
};
const statusLabels: Record<TyreStatus, unknown> = {
  GOOD: translatedText,
  RECOMMENDED: translatedText,
  URGENT: translatedText,
};
const stateLabels: Record<TyreEvaluation['state'], unknown> = {
  EVALUATED: translatedText,
  UNSUPPORTED_COUNTRY: translatedText,
};

function readLocale(locale: string, namespace: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(
        `../../../../locales/${locale}/${namespace}.json`,
        import.meta.url,
      ),
      'utf8',
    ),
  ) as unknown;
}

describe.each(['de', 'en'])('tyre translations (%s)', (locale) => {
  it('covers every reason code with a nonblank translated label', () => {
    expect(readLocale(locale, 'workshop')).toHaveProperty(
      'tyreMeasurement.reasons',
      reasonLabels,
    );
  });

  it('covers every measurement status with a nonblank translated label', () => {
    expect(readLocale(locale, 'enums')).toHaveProperty(
      'tyreMeasurementStatus',
      statusLabels,
    );
  });

  it('covers every evaluation state with a nonblank translated label', () => {
    expect(readLocale(locale, 'enums')).toHaveProperty(
      'tyreEvaluationState',
      stateLabels,
    );
  });
});

it('explicitly labels the German amber status as a recommendation', () => {
  expect(readLocale('de', 'enums')).toHaveProperty(
    'tyreMeasurementStatus.RECOMMENDED',
    expect.stringContaining('Empfehlung'),
  );
});

it.each([
  ['de', 'Messwerte unauffällig'],
  ['en', 'Measured values within thresholds'],
])('limits the %s green label to measured values', (locale, label) => {
  expect(readLocale(locale, 'enums')).toHaveProperty(
    'tyreMeasurementStatus.GOOD',
    label,
  );
});
