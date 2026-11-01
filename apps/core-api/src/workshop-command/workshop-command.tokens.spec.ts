import {
  commandFingerprint,
  isSelectionOffered,
  parsedFromReplay,
  replayFromParsed,
  sameSelections,
  sameTokens,
  tokensOfParsed,
} from './workshop-command.tokens.js';
import { parseCommandText } from './workshop-command.parse.js';

const SITES = [
  { code: 'WIE', name: 'Pilot Wien' },
  { code: 'NORD', name: 'Pilot Nord' },
];
const NOW = new Date('2026-10-15T14:30:00+02:00');

function parsed() {
  return parseCommandText(
    'Huber Golf morgen 8 Uhr großes Service + Pickerl, Bremsen vorne prüfen, Leihwagen reservieren',
    { sites: SITES },
    NOW,
    'Europe/Vienna',
  );
}

describe('workshop command replay tokens', () => {
  it('round-trips a parsed command through the stored replay shape', () => {
    const source = parsed();
    const replay = replayFromParsed(source, {
      selections: [],
      offeredChoices: [],
      status: 'ready',
      reviewedIntent: null,
    });
    const restored = parsedFromReplay(replay);

    expect(tokensOfParsed(restored)).toEqual(tokensOfParsed(source));
    expect(restored.unsupportedClauses).toEqual(source.unsupportedClauses);
    expect(restored.humanOnly).toBe(source.humanOnly);
    expect(restored.unsupportedGrammar).toBe(source.unsupportedGrammar);
    expect(replay.reviewed_fingerprint).toBeNull();
  });

  it('hashes equal tokens and selections equally, independent of order', () => {
    const tokens = tokensOfParsed(parsed());
    const a = commandFingerprint(tokens, [
      { slot: 'customer_id', value: 'c1' },
      { slot: 'bay_id', value: 'b1' },
    ]);
    const b = commandFingerprint(tokens, [
      { slot: 'bay_id', value: 'b1' },
      { slot: 'customer_id', value: 'c1' },
    ]);
    expect(a).toBe(b);
    expect(commandFingerprint(tokens, [{ slot: 'bay_id', value: 'b2' }])).not.toBe(a);
  });

  it('compares stored tokens independent of JSONB key order', () => {
    const tokens = tokensOfParsed(parsed());
    // A JSONB round-trip reorders object keys (identity: model before surname).
    const stored = JSON.parse(
      JSON.stringify(tokens)
        .replace('"kind":"surname_model","surname":"Huber","model":"Golf"', '"kind":"surname_model","model":"Golf","surname":"Huber"'),
    );
    expect(sameTokens(stored, tokens)).toBe(true);
    expect(sameTokens({ ...tokens, start_clock: '09:00' }, tokens)).toBe(false);
  });

  it('compares selection sets without order or duplicates', () => {
    expect(
      sameSelections(
        [{ slot: 'a', value: '1' }],
        [{ slot: 'a', value: '1' }],
      ),
    ).toBe(true);
    expect(
      sameSelections(
        [{ slot: 'a', value: '1' }],
        [{ slot: 'a', value: '2' }],
      ),
    ).toBe(false);
  });

  it('accepts only offered slot/value pairs', () => {
    const offered = [{ slot: 'customer_id', value: 'c1' }];
    expect(isSelectionOffered({ slot: 'customer_id', value: 'c1' }, offered)).toBe(true);
    expect(isSelectionOffered({ slot: 'customer_id', value: 'c2' }, offered)).toBe(false);
    expect(isSelectionOffered({ slot: 'bay_id', value: 'c1' }, offered)).toBe(false);
  });
});
