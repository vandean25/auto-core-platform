import { createHash } from 'node:crypto';
import type {
  CommandChoice,
  CommandSelection,
  ParsedCommand,
  ParsedDay,
  ParsedIdentity,
} from './workshop-command.types.js';

/**
 * The token fields that identify one interpreted sentence. They are the only
 * fields compared for `COMMAND_ID_REUSED` and the only stable input for the
 * command fingerprint. No raw sentence is part of them.
 */
export type WorkshopCommandTokens = {
  identity: ParsedIdentity | null;
  day: ParsedDay | null;
  start_clock: string | null;
  end_clock: string | null;
  clocks: string[];
  preset_keys: string[];
  loaner_requested: boolean;
  named_site: string | null;
};

/**
 * Replay row stored in `workshop_command_sessions.normalized_json`.
 *
 * The first block matches the contract. `clocks`, `unsupported_clauses`,
 * `human_only`, `unsupported_grammar`, and `last_status` are additive so the
 * server can reproduce the exact clarification from tokens alone; the raw
 * sentence and transcript are never stored.
 */
export type WorkshopCommandReplay = WorkshopCommandTokens & {
  unsupported_clauses: string[];
  human_only: boolean;
  unsupported_grammar: boolean;
  selections: CommandSelection[];
  offered_choices: Array<{ slot: string; value: string }>;
  last_status: 'ready' | 'clarification';
};

export type WorkshopCommandResultStatus = 'ready' | 'clarification';

export function tokensOfParsed(parsed: ParsedCommand): WorkshopCommandTokens {
  return {
    identity: parsed.identity,
    day: parsed.day,
    start_clock: parsed.startClock,
    end_clock: parsed.endClock,
    clocks: [...parsed.clocks],
    preset_keys: [...parsed.presetKeys],
    loaner_requested: parsed.loanerRequested,
    named_site: parsed.namedSite,
  };
}

export function replayFromParsed(
  parsed: ParsedCommand,
  input: {
    selections: CommandSelection[];
    offeredChoices: Array<{ slot: string; value: string }>;
    status: WorkshopCommandResultStatus;
  },
): WorkshopCommandReplay {
  return {
    ...tokensOfParsed(parsed),
    unsupported_clauses: [...parsed.unsupportedClauses],
    human_only: parsed.humanOnly,
    unsupported_grammar: parsed.unsupportedGrammar,
    selections: input.selections.map((entry) => ({
      slot: entry.slot,
      value: entry.value,
    })),
    offered_choices: input.offeredChoices.map((entry) => ({
      slot: entry.slot,
      value: entry.value,
    })),
    last_status: input.status,
  };
}

export function offeredChoicesOf(choices: CommandChoice[]): Array<{
  slot: string;
  value: string;
}> {
  return choices.map((entry) => ({ slot: entry.slot, value: entry.value }));
}

export function parsedFromReplay(replay: WorkshopCommandReplay): ParsedCommand {
  const recognized: Record<string, unknown> = {};
  if (replay.identity?.kind === 'surname_model') {
    recognized.customer_token = replay.identity.surname;
    recognized.vehicle_token = replay.identity.model;
  }
  if (replay.named_site) {
    recognized.named_site_code = replay.named_site;
  }
  return {
    identity: replay.identity,
    day: replay.day,
    startClock: replay.start_clock,
    endClock: replay.end_clock,
    clocks: [...replay.clocks],
    presetKeys: [...replay.preset_keys],
    loanerRequested: replay.loaner_requested,
    namedSite: replay.named_site,
    namedSiteLabel: null,
    unsupportedClauses: [...replay.unsupported_clauses],
    humanOnly: replay.human_only,
    unsupportedGrammar: replay.unsupported_grammar,
    recognized,
  };
}

export function isSelectionOffered(
  selection: CommandSelection,
  offered: Array<{ slot: string; value: string }>,
): boolean {
  return offered.some(
    (entry) => entry.slot === selection.slot && entry.value === selection.value,
  );
}

export function selectTokens(
  replay: WorkshopCommandReplay,
): WorkshopCommandTokens {
  return {
    identity: replay.identity,
    day: replay.day,
    start_clock: replay.start_clock,
    end_clock: replay.end_clock,
    clocks: [...replay.clocks],
    preset_keys: [...replay.preset_keys],
    loaner_requested: replay.loaner_requested,
    named_site: replay.named_site,
  };
}

/** Canonical JSON with sorted object keys so equal tokens hash equally. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = canonicalize(record[key]);
    }
    return sorted;
  }
  return value;
}

export function commandFingerprint(
  tokens: WorkshopCommandTokens,
  selections: CommandSelection[],
): string {
  const sortedSelections = [...selections].sort((a, b) => {
    if (a.slot !== b.slot) return a.slot.localeCompare(b.slot);
    return a.value.localeCompare(b.value);
  });
  const canonical = JSON.stringify(
    canonicalize({ tokens, selections: sortedSelections }),
  );
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Compares stored and freshly parsed tokens by canonical key order. A JSONB
 * round-trip reorders object keys, so a raw `JSON.stringify` comparison would
 * reject an identical command.
 */
export function sameTokens(
  left: WorkshopCommandTokens,
  right: WorkshopCommandTokens,
): boolean {
  return (
    JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right))
  );
}

export function sameSelections(
  left: CommandSelection[],
  right: CommandSelection[],
): boolean {
  if (left.length !== right.length) return false;
  const normalize = (entries: CommandSelection[]) =>
    entries
      .map((entry) => `${entry.slot}\u0000${entry.value}`)
      .sort()
      .join('\u0001');
  return normalize(left) === normalize(right);
}
