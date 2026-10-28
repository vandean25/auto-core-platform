import { parseCommandText, resolveCommandDay } from './workshop-command.parse.js';
import { resolveWallClock } from './workshop-command.time.js';

const SITES = [
  { code: 'WIE', name: 'Pilot Wien' },
  { code: 'NORD', name: 'Pilot Nord' },
];

const NOW = new Date('2026-10-15T14:30:00+02:00');

describe('workshop command parser', () => {
  it('parses the canonical sentence into identity, day, clocks and presets', () => {
    const parsed = parseCommandText(
      'Huber Golf morgen 8 Uhr großes Service + Pickerl, Bremsen vorne prüfen, Leihwagen reservieren',
      { sites: SITES },
      NOW,
      'Europe/Vienna',
    );

    expect(parsed.identity).toEqual({ kind: 'surname_model', surname: 'Huber', model: 'Golf' });
    expect(parsed.day).toEqual({ kind: 'relative', word: 'morgen' });
    expect(parsed.startClock).toBe('08:00');
    expect(parsed.presetKeys).toEqual([
      'service.major',
      'inspection.pickerl_57a',
      'inspection.brakes_front',
    ]);
    expect(parsed.loanerRequested).toBe(true);
    expect(parsed.unsupportedClauses).toEqual([]);
    expect(resolveCommandDay(parsed.day!, NOW, 'Europe/Vienna')).toBe('2026-10-16');
  });

  it('parses a plate as the whole identity', () => {
    const parsed = parseCommandText(
      'W-SYN 515 morgen 8 Uhr kleines Service',
      { sites: SITES },
      NOW,
      'Europe/Vienna',
    );

    expect(parsed.identity).toEqual({ kind: 'plate', plate: 'W-SYN 515' });
    expect(parsed.presetKeys).toEqual(['service.minor']);
    expect(parsed.unsupportedClauses).toEqual([]);
  });

  it('parses a VIN as the whole identity', () => {
    const parsed = parseCommandText(
      'WVWZZZ3CZWE000515 morgen 8 Uhr kleines Service',
      { sites: SITES },
      NOW,
      'Europe/Vienna',
    );

    expect(parsed.identity).toEqual({ kind: 'vin', vin: 'WVWZZZ3CZWE000515' });
  });

  it('keeps an unknown service as an unsupported clause', () => {
    const parsed = parseCommandText(
      'Huber Golf morgen 8 Uhr Klimaservice',
      { sites: SITES },
      NOW,
      'Europe/Vienna',
    );

    expect(parsed.identity).toEqual({ kind: 'surname_model', surname: 'Huber', model: 'Golf' });
    expect(parsed.unsupportedClauses).toEqual(['Klimaservice']);
  });

  it('records two start clocks as contradictory', () => {
    const parsed = parseCommandText(
      'Huber Golf morgen 8 Uhr und um 10 Uhr großes Service',
      { sites: SITES },
      NOW,
      'Europe/Vienna',
    );

    expect(parsed.clocks).toEqual(['08:00', '10:00']);
    expect(parsed.startClock).toBe('08:00');
    expect(parsed.endClock).toBeNull();
  });

  it('splits a "bis" clock into end time', () => {
    const parsed = parseCommandText(
      'Huber Golf morgen 8 Uhr bis 10 Uhr großes Service',
      { sites: SITES },
      NOW,
      'Europe/Vienna',
    );

    expect(parsed.startClock).toBe('08:00');
    expect(parsed.endClock).toBe('10:00');
  });

  it('recognizes the named site NORD', () => {
    const parsed = parseCommandText(
      'Huber Golf morgen 8 Uhr großes Service Standort NORD',
      { sites: SITES },
      NOW,
      'Europe/Vienna',
    );

    expect(parsed.namedSite).toBe('NORD');
  });
});

describe('workshop command time', () => {
  it('resolves one instant on a normal day', () => {
    const instants = resolveWallClock('Europe/Vienna', '2026-10-16', '08:00');
    expect(instants.map((instant) => instant.toISOString())).toEqual(['2026-10-16T06:00:00.000Z']);
  });

  it('returns both instants across the fall-back overlap', () => {
    const instants = resolveWallClock('Europe/Vienna', '2026-10-25', '02:30');
    expect(instants.map((instant) => instant.toISOString())).toEqual([
      '2026-10-25T00:30:00.000Z',
      '2026-10-25T01:30:00.000Z',
    ]);
  });

  it('returns no instant in the spring-forward gap', () => {
    expect(resolveWallClock('Europe/Vienna', '2027-03-28', '02:30')).toEqual([]);
  });
});
