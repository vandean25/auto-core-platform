export const WORKSHOP_COMMAND_CONTRACT_VERSION = 'workshop-command/v1';
export const WORKSHOP_COMMAND_LOCALE = 'de-AT';
export const WORKSHOP_COMMAND_MAX_TEXT_LENGTH = 500;
export const WORKSHOP_COMMAND_ACTION_TYPE = 'workshop.booking_package';

export type CommandSelection = {
  slot: string;
  value: string;
};

export type ParsedIdentity =
  | { kind: 'surname_model'; surname: string; model: string }
  | { kind: 'plate'; plate: string }
  | { kind: 'vin'; vin: string };

export type ParsedDay =
  | { kind: 'relative'; word: string }
  | { kind: 'absolute'; day: number; month: number; year?: number };

export type ParsedCommand = {
  identity: ParsedIdentity | null;
  day: ParsedDay | null;
  startClock: string | null;
  endClock: string | null;
  clocks: string[];
  presetKeys: string[];
  loanerRequested: boolean;
  namedSite: string | null;
  namedSiteLabel: string | null;
  unsupportedClauses: string[];
  humanOnly: boolean;
  unsupportedGrammar: boolean;
  recognized: Record<string, unknown>;
};

export type CommandChoice = {
  choice_id: string;
  slot: string;
  value: string;
  label: string;
};

export type ClarificationCode =
  | 'HUMAN_ONLY_EXCLUDED'
  | 'UNSUPPORTED_GRAMMAR'
  | 'TIME_CONTRADICTORY'
  | 'UNSUPPORTED_SERVICE'
  | 'SITE_MISMATCH'
  | 'CUSTOMER_NOT_FOUND'
  | 'CUSTOMER_AMBIGUOUS'
  | 'VEHICLE_NOT_FOUND'
  | 'VEHICLE_AMBIGUOUS'
  | 'IDENTITY_CONTRADICTION'
  | 'TIME_DOES_NOT_EXIST'
  | 'TIME_AMBIGUOUS'
  | 'TIME_IN_PAST'
  | 'PRESET_NOT_CONFIGURED'
  | 'DURATION_REQUIRED'
  | 'RESOURCE_MISSING'
  | 'RESOURCE_AMBIGUOUS'
  | 'LOANER_NOT_PERMITTED';

export type PositionPlanLine = {
  preset_key?: string;
  kind: 'LABOR' | 'PART';
  labor_operation_id: string | null;
  catalog_item_id: string | null;
  description: string;
  quantity: string;
  unit: string;
  unit_price_cents: number;
  net_cents: number;
  reservation: 'not_applicable' | 'unbooked' | 'reserved';
};

export type WorkshopIntent = {
  contract_version: typeof WORKSHOP_COMMAND_CONTRACT_VERSION;
  status: 'ready';
  command_id: string;
  site_id: string;
  timezone: string;
  customer_id: string;
  vehicle_id: string;
  schedule: {
    local_date: string;
    local_start: string;
    local_end: string;
    start_at: string;
    end_at: string;
    duration_minutes: number;
    duration_source: 'preset_sum' | 'end_clock';
  };
  bay_id: string;
  mechanic_id: null;
  loaner: {
    requested: boolean;
    loaner_vehicle_id: string | null;
    planned_from: string | null;
    planned_to: string | null;
  };
  position_plan: {
    version: 1;
    lines: PositionPlanLine[];
  };
  purpose: 'CUSTOMER_REPAIR';
  order_status: 'SCHEDULED';
  reported_issue: string;
};

export type Clarification = {
  contract_version: typeof WORKSHOP_COMMAND_CONTRACT_VERSION;
  status: 'clarification';
  command_id: string;
  code: ClarificationCode;
  prompt: string;
  choices: CommandChoice[];
  recognized: Record<string, unknown>;
  proposal: null;
};

export type InterpretResult = WorkshopIntent | Clarification;

export type ProposalResult = {
  contract_version: typeof WORKSHOP_COMMAND_CONTRACT_VERSION;
  status: 'needs_approval';
  command_id: string;
  pending_action_id: string;
  trace_id: string;
  action_type: typeof WORKSHOP_COMMAND_ACTION_TYPE;
  tier: 'PROPOSE';
  provisional: true;
  applied: false;
  would_change: unknown[];
  intent: Omit<WorkshopIntent, 'status'>;
};

export const CLARIFICATION_PROMPTS: Record<ClarificationCode, string> = {
  HUMAN_ONLY_EXCLUDED:
    'Diese Aktion bleibt bei einer Person und wird nicht vorgeschlagen.',
  UNSUPPORTED_GRAMMAR: 'Der Satz liegt außerhalb der unterstützten Eingaben.',
  TIME_CONTRADICTORY: 'Zwei Uhrzeiten widersprechen sich. Bitte eine wählen.',
  UNSUPPORTED_SERVICE: 'Diese Leistung ist nicht in der lokalen Liste.',
  SITE_MISMATCH: 'Der genannte Standort ist nicht der aktive Standort.',
  CUSTOMER_NOT_FOUND: 'Kein Kunde mit diesem Namen im Mandanten.',
  CUSTOMER_AMBIGUOUS: 'Mehrere Kunden passen. Bitte einen auswählen.',
  VEHICLE_NOT_FOUND: 'Beim Kunden gibt es kein passendes Fahrzeug.',
  VEHICLE_AMBIGUOUS: 'Mehrere Fahrzeuge passen. Bitte eines auswählen.',
  IDENTITY_CONTRADICTION: 'Name und Kennzeichen passen nicht zusammen.',
  TIME_DOES_NOT_EXIST: 'Diese Uhrzeit gibt es an diesem Tag nicht.',
  TIME_AMBIGUOUS:
    'Diese Uhrzeit gibt es an diesem Tag zweimal. Bitte eine wählen.',
  TIME_IN_PAST: 'Der Termin liegt in der Vergangenheit.',
  PRESET_NOT_CONFIGURED:
    'Die Leistung ist erkannt, aber am Standort nicht hinterlegt.',
  DURATION_REQUIRED:
    'Ohne Endzeit oder hinterlegte Dauer kann der Termin nicht berechnet werden.',
  RESOURCE_MISSING: 'Keine freie Ressource am aktiven Standort.',
  RESOURCE_AMBIGUOUS: 'Mehrere Ressourcen passen. Bitte eine wählen.',
  LOANER_NOT_PERMITTED:
    'Leihwagen können mit diesem Konto nicht reserviert werden.',
};
