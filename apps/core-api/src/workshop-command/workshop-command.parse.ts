import type {
  ParsedCommand,
  ParsedDay,
  ParsedIdentity,
} from './workshop-command.types.js';
import {
  addLocalDays as addLocalDaysImpl,
  localDateOf as localDateOfImpl,
} from './workshop-command.time.js';

export type CommandSiteRef = { code: string; name: string };

export type ParseCommandOptions = {
  sites: CommandSiteRef[];
};

type Mask = boolean[];

type WordMatch = { start: number; end: number; value: string };

const DAY_WORDS = [
  'heute',
  'morgen',
  'übermorgen',
  'uebermorgen',
  'montag',
  'dienstag',
  'mittwoch',
  'donnerstag',
  'freitag',
  'samstag',
  'sonntag',
] as const;

const PRESET_PHRASES: Array<{ phrase: string; key: string; loaner?: boolean }> =
  [
    { phrase: 'bremsen vorne prüfen', key: 'inspection.brakes_front' },
    { phrase: 'bremsen vorne pruefen', key: 'inspection.brakes_front' },
    { phrase: 'bremsen hinten prüfen', key: 'inspection.brakes_rear' },
    { phrase: 'bremsen hinten pruefen', key: 'inspection.brakes_rear' },
    { phrase: 'großes service', key: 'service.major' },
    { phrase: 'grosses service', key: 'service.major' },
    { phrase: 'kleines service', key: 'service.minor' },
    { phrase: 'ölwechsel', key: 'service.oil' },
    { phrase: 'oelwechsel', key: 'service.oil' },
    { phrase: 'leihwagen reservieren', key: 'loaner.reserve', loaner: true },
    { phrase: 'leihwagen', key: 'loaner.reserve', loaner: true },
    { phrase: 'pickerl', key: 'inspection.pickerl_57a' },
    { phrase: '§57a', key: 'inspection.pickerl_57a' },
    { phrase: '57a', key: 'inspection.pickerl_57a' },
  ];

const HUMAN_ONLY_PATTERN =
  /\b(kva\s+senden|kostenvoranschlag\s+senden|rechnung|bezahlen|mailen|anrufen)\b/iu;
const UNSUPPORTED_GRAMMAR_PATTERN =
  /\b(neuer\s+kunde|fahrzeug\s+anlegen|löschen|loeschen|stornieren|preis|euro|mechaniker|stunden?|minuten?)\b/iu;

function normalizeText(text: string): string {
  return text.normalize('NFC').trim().replace(/\s+/gu, ' ');
}

function consume(mask: Mask, start: number, end: number): void {
  for (let index = start; index < end; index += 1) {
    mask[index] = true;
  }
}

function isMasked(mask: Mask, start: number, end: number): boolean {
  for (let index = start; index < end; index += 1) {
    if (mask[index]) return true;
  }
  return false;
}

function normalizeClock(hour: number, minute: number): string | null {
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function findVin(normalized: string, mask: Mask): WordMatch | null {
  const regex = /(?<![A-Z0-9])[A-HJ-NPR-Z0-9]{17}(?![A-Z0-9])/giu;
  for (const match of normalized.matchAll(regex)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (isMasked(mask, start, end)) continue;
    return { start, end, value: match[0].toUpperCase() };
  }
  return null;
}

function findPlate(normalized: string, mask: Mask): WordMatch | null {
  // Case-sensitive on purpose: Austrian plates are written in upper case, and a
  // case-insensitive match would swallow ordinary words such as "morgen 8".
  const regex =
    /(?<![A-ZÄÖÜ0-9])([A-ZÄÖÜ]{1,2})-?([A-Z]{1,4})[ -]?([0-9]{1,5})([A-Z])?(?![A-Z0-9])/gu;
  for (const match of normalized.matchAll(regex)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (isMasked(mask, start, end)) continue;
    return { start, end, value: match[0].toUpperCase() };
  }
  return null;
}

function findClocks(
  normalized: string,
  mask: Mask,
): Array<{ start: number; end: number; clock: string }> {
  const regex =
    /(?<![A-Z0-9:])(?:um\s+)?(\d{1,2}):(\d{2})(?:\s*uhr)?|(?<![A-Z0-9:])(?:um\s+)?(\d{1,2})\s*uhr/giu;
  const found: Array<{ start: number; end: number; clock: string }> = [];
  for (const match of normalized.matchAll(regex)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (isMasked(mask, start, end)) continue;
    const clock =
      match[1] !== undefined
        ? normalizeClock(Number(match[1]), Number(match[2]))
        : normalizeClock(Number(match[3]), 0);
    if (!clock) continue;
    found.push({ start, end, clock });
  }
  return found;
}

function findDay(
  normalized: string,
  lower: string,
  mask: Mask,
): { day: ParsedDay; start: number; end: number } | null {
  const wordRegex = new RegExp(`\\b(${DAY_WORDS.join('|')})\\b`, 'giu');
  for (const match of lower.matchAll(wordRegex)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (isMasked(mask, start, end)) continue;
    const word = match[0].toLocaleLowerCase('de-AT');
    const normalizedWord = word === 'uebermorgen' ? 'übermorgen' : word;
    return {
      day: { kind: 'relative', word: normalizedWord },
      start,
      end,
    };
  }

  const absoluteRegex = /\bam\s+(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\b/giu;
  for (const match of normalized.matchAll(absoluteRegex)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (isMasked(mask, start, end)) continue;
    return {
      day: {
        kind: 'absolute',
        day: Number(match[1]),
        month: Number(match[2]),
        ...(match[3] ? { year: Number(match[3]) } : {}),
      },
      start,
      end,
    };
  }
  return null;
}

function phraseRegex(phrase: string): RegExp {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu');
}

function findPresets(
  lower: string,
  mask: Mask,
): { keys: string[]; loaner: boolean } {
  const found: Array<{
    start: number;
    end: number;
    key: string;
    loaner: boolean;
  }> = [];
  for (const preset of PRESET_PHRASES) {
    const regex = phraseRegex(preset.phrase);
    for (const match of lower.matchAll(regex)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (isMasked(mask, start, end)) continue;
      found.push({
        start,
        end,
        key: preset.key,
        loaner: preset.loaner === true,
      });
    }
  }
  found.sort((a, b) => a.start - b.start);

  const keys: string[] = [];
  let loaner = false;
  for (const preset of found) {
    if (isMasked(mask, preset.start, preset.end)) continue;
    consume(mask, preset.start, preset.end);
    if (preset.loaner) {
      loaner = true;
    } else if (!keys.includes(preset.key)) {
      keys.push(preset.key);
    }
  }
  return { keys, loaner };
}

function findSite(
  normalized: string,
  lower: string,
  mask: Mask,
  sites: CommandSiteRef[],
): { code: string; label: string; start: number; end: number } | null {
  const match = /\bstandort\b/iu.exec(lower);
  if (!match) return null;
  const start = match.index ?? 0;
  const end = start + match[0].length;
  if (isMasked(mask, start, end)) return null;

  const rest = lower.slice(end);
  const candidates = sites
    .flatMap((site) => [
      { site, token: site.code.toLocaleLowerCase('de-AT') },
      { site, token: site.name.toLocaleLowerCase('de-AT') },
    ])
    .sort((a, b) => b.token.length - a.token.length);

  for (const candidate of candidates) {
    if (!rest.startsWith(` ${candidate.token}`)) continue;
    const suffix = rest.slice(candidate.token.length + 1);
    if (suffix && !/^[\s,+.]/u.test(suffix)) continue;
    const siteEnd = end + 1 + candidate.token.length;
    consume(mask, start, siteEnd);
    return {
      code: candidate.site.code,
      label: candidate.site.name,
      start,
      end: siteEnd,
    };
  }
  return null;
}

function maskSeparators(lower: string, mask: Mask): void {
  const regex = /\bund\b|[,+]/gu;
  for (const match of lower.matchAll(regex)) {
    const start = match.index ?? 0;
    consume(mask, start, start + match[0].length);
  }
}

function clauseRanges(
  normalized: string,
  mask: Mask,
): Array<{ start: number; end: number }> {
  // Split on actual separator characters only. Masked runs stay inside a clause and are skipped below.
  const ranges: Array<{ start: number; end: number }> = [];
  let start = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index] === ',' || normalized[index] === '+') {
      ranges.push({ start, end: index });
      start = index + 1;
    }
  }
  ranges.push({ start, end: normalized.length });

  // `und` is a clause separator when unmasked.
  const result: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    let cursor = range.start;
    const regex = /\bund\b/giu;
    const slice = normalized.slice(range.start, range.end);
    for (const match of slice.matchAll(regex)) {
      const matchStart = range.start + (match.index ?? 0);
      const matchEnd = matchStart + match[0].length;
      if (isMasked(mask, matchStart, matchEnd)) continue;
      result.push({ start: cursor, end: matchStart });
      cursor = matchEnd;
    }
    result.push({ start: cursor, end: range.end });
  }
  return result;
}

function unmaskedText(
  normalized: string,
  mask: Mask,
  range: { start: number; end: number },
): { text: string; tokens: Array<{ value: string; start: number }> } {
  const tokens: Array<{ value: string; start: number }> = [];
  let current = '';
  let currentStart = -1;
  for (let index = range.start; index < range.end; index += 1) {
    const char = normalized[index];
    if (mask[index] || /\s/u.test(char)) {
      if (current) {
        tokens.push({ value: current, start: currentStart });
        current = '';
        currentStart = -1;
      }
      continue;
    }
    if (!current) currentStart = index;
    current += char;
  }
  if (current) tokens.push({ value: current, start: currentStart });
  return { text: tokens.map((token) => token.value).join(' '), tokens };
}

function resolveDay(day: ParsedDay, now: Date, timeZone: string): string {
  const today = localDateOfImpl(now, timeZone);
  if (day.kind === 'relative') {
    switch (day.word) {
      case 'heute':
        return today;
      case 'morgen':
        return addLocalDaysImpl(today, 1);
      case 'übermorgen':
        return addLocalDaysImpl(today, 2);
      default: {
        const weekdays: Record<string, number> = {
          montag: 1,
          dienstag: 2,
          mittwoch: 3,
          donnerstag: 4,
          freitag: 5,
          samstag: 6,
          sonntag: 7,
        };
        const target = weekdays[day.word];
        if (!target) return today;
        const todayParts = today.split('-').map(Number);
        const jsDay = new Date(
          Date.UTC(todayParts[0], todayParts[1] - 1, todayParts[2]),
        ).getUTCDay();
        const isoToday = jsDay === 0 ? 7 : jsDay;
        const delta = (target - isoToday + 7) % 7 || 7;
        return addLocalDaysImpl(today, delta);
      }
    }
  }

  const year = day.year ?? Number(today.slice(0, 4));
  return `${String(year).padStart(4, '0')}-${String(day.month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`;
}

type Clause = {
  range: { start: number; end: number };
  text: string;
  tokens: TokenRef[];
};
type TokenRef = { value: string; start: number };

type ParsedIdentityMatch = {
  identity: ParsedIdentity | null;
  clauseIndex: number;
  leftovers: string[];
};

function parseIdentity(
  vin: WordMatch | null,
  plate: WordMatch | null,
  clauses: Clause[],
): ParsedIdentityMatch {
  if (vin)
    return {
      identity: { kind: 'vin', vin: vin.value },
      clauseIndex: -1,
      leftovers: [],
    };
  if (plate) {
    return {
      identity: { kind: 'plate', plate: plate.value },
      clauseIndex: -1,
      leftovers: [],
    };
  }
  const tokens = clauses[0]?.tokens ?? [];
  if (tokens.length < 2)
    return { identity: null, clauseIndex: -1, leftovers: [] };
  return {
    identity: {
      kind: 'surname_model',
      surname: tokens[0].value,
      model: tokens[1].value,
    },
    clauseIndex: 0,
    leftovers: tokens.slice(2).map((token) => token.value),
  };
}

function collectUnsupportedClauses(
  clauses: Clause[],
  identityClauseIndex: number,
  leftovers: string[],
): string[] {
  const others = clauses
    .filter((_, index) => index !== identityClauseIndex)
    .map((clause) => clause.text);
  return [
    ...others,
    ...(leftovers.length > 0 ? [leftovers.join(' ')] : []),
  ].filter(Boolean);
}

type ClockRef = { start: number; end: number; clock: string };

function pickClock(
  clocks: ClockRef[],
  matches: (clock: ClockRef) => boolean,
): string | null {
  const match = clocks.find(matches);
  return match ? match.clock : null;
}

function splitClocks(
  clocks: ClockRef[],
  lower: string,
): { startClock: string | null; endClock: string | null } {
  const bisIndex = lower.search(/\bbis\b/iu);
  if (bisIndex < 0)
    return { startClock: pickClock(clocks, () => true), endClock: null };
  return {
    startClock: pickClock(clocks, (clock) => clock.start < bisIndex),
    endClock: pickClock(clocks, (clock) => clock.start > bisIndex),
  };
}

function buildRecognized(
  identity: ParsedIdentity | null,
  siteCode: string | undefined,
): Record<string, unknown> {
  const recognized: Record<string, unknown> = {};
  if (identity?.kind === 'surname_model') {
    recognized.customer_token = identity.surname;
    recognized.vehicle_token = identity.model;
  }
  if (siteCode) recognized.named_site_code = siteCode;
  return recognized;
}

export function parseCommandText(
  rawText: string,
  options: ParseCommandOptions,
  now: Date,
  timeZone: string,
): ParsedCommand {
  const normalized = normalizeText(rawText);
  const lower = normalized.toLocaleLowerCase('de-AT');
  const mask: Mask = new Array<boolean>(normalized.length).fill(false);

  const humanOnly = HUMAN_ONLY_PATTERN.test(lower);
  const unsupportedGrammar = UNSUPPORTED_GRAMMAR_PATTERN.test(lower);

  const vin = findVin(normalized, mask);
  if (vin) consume(mask, vin.start, vin.end);
  const plate = vin ? null : findPlate(normalized, mask);
  if (plate) consume(mask, plate.start, plate.end);

  const clocks = findClocks(normalized, mask);
  for (const clock of clocks) consume(mask, clock.start, clock.end);

  const dayMatch = findDay(normalized, lower, mask);
  if (dayMatch) consume(mask, dayMatch.start, dayMatch.end);

  const presetResult = findPresets(lower, mask);
  const siteMatch = findSite(normalized, lower, mask, options.sites);
  maskSeparators(lower, mask);

  const clauses = clauseRanges(normalized, mask)
    .map((range) => ({ range, ...unmaskedText(normalized, mask, range) }))
    .filter((clause) => clause.tokens.length > 0);

  const identityMatch = parseIdentity(vin, plate, clauses);
  const { startClock, endClock } = splitClocks(clocks, lower);

  return {
    identity: identityMatch.identity,
    day: dayMatch ? resolveParsedDay(dayMatch.day, now, timeZone) : null,
    startClock,
    endClock,
    clocks: clocks.map((clock) => clock.clock),
    presetKeys: presetResult.keys,
    loanerRequested: presetResult.loaner,
    namedSite: siteMatch?.code ?? null,
    namedSiteLabel: siteMatch?.label ?? null,
    unsupportedClauses: collectUnsupportedClauses(
      clauses,
      identityMatch.clauseIndex,
      identityMatch.leftovers,
    ),
    humanOnly,
    unsupportedGrammar,
    recognized: buildRecognized(identityMatch.identity, siteMatch?.code),
  };
}

function resolveParsedDay(
  day: ParsedDay,
  now: Date,
  timeZone: string,
): ParsedDay {
  // Keep the parsed day in the contract; the resolver converts it to a local date.
  void resolveDay(day, now, timeZone);
  return day;
}

export function resolveCommandDay(
  day: ParsedDay,
  now: Date,
  timeZone: string,
): string {
  return resolveDay(day, now, timeZone);
}
