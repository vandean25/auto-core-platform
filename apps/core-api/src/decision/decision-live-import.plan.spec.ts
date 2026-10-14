import { ImportRowAction } from '@prisma/client';
import type { DryRunRowResult } from '../import/import.types.js';
import {
  buildImportLiveDecisions,
  pairRedactedChoices,
  planImportChange,
  type ImportCall,
  type ImportPlan,
  type ImportWriteState,
} from './decision-live-import.plan.js';
import type { ProviderCall } from './decision-live-apply.types.js';
import type { ImportRowMatchingCase } from './decision-use-case-hooks.service.js';

const CREATE_NEW = 'create_new';
const CUSTOMER_CHOICE = 'customer-1';
const NO_WRITE: ImportWriteState = {
  appliedRowNos: new Set<number>(),
  applyFailed: false,
  proposalFailed: false,
};

function importCase(
  overrides: Partial<ImportRowMatchingCase> = {},
): ImportRowMatchingCase {
  return {
    row: { row_no: 1, action: ImportRowAction.CREATE } as DryRunRowResult,
    input: { row: { type: 'PRIVATE', match_features: [] }, candidates: [] },
    choices: [CUSTOMER_CHOICE, CREATE_NEW],
    candidateTargets: [{ choice: CUSTOMER_CHOICE, entityId: CUSTOMER_CHOICE }],
    createChoice: CREATE_NEW,
    actualChoice: CREATE_NEW,
    ...overrides,
  };
}

function importCall(
  providerCall: ProviderCall,
  matchingCase: ImportRowMatchingCase = importCase(),
): ImportCall {
  const redactedChoices = ['choice_1', 'choice_2'];
  return {
    matchingCase,
    redactedInput: {},
    redactedChoices,
    redactedRulesChoice: 'choice_2',
    originalByRedacted: pairRedactedChoices(
      redactedChoices,
      matchingCase.choices,
    ),
    providerCall,
  };
}

function suggested(choice: string): ProviderCall {
  return {
    ok: true,
    suggestion: {
      choice,
      raw_ref: 'raw-1',
      latency_ms: 5,
      provider: 'openrouter-jev',
      model: 'typesafe/jev-1.13',
    },
  };
}

describe('planImportChange', () => {
  it('keeps the provider reason when there is no usable suggestion', () => {
    const plan = planImportChange(
      importCall({ ok: false, reason: 'timeout', suggestion: null }),
    );

    expect(plan).toEqual({
      kind: 'fallback',
      call: expect.anything(),
      reason: 'timeout',
    });
  });

  it('falls back as invalid_choice when the redacted label is unknown', () => {
    const plan = planImportChange(importCall(suggested('choice_9')));

    expect(plan).toMatchObject({ kind: 'fallback', reason: 'invalid_choice' });
  });

  it('falls back as suggestion_matches_rules when the suggestion equals the rules choice', () => {
    const plan = planImportChange(
      importCall(
        suggested('choice_1'),
        importCase({ actualChoice: CUSTOMER_CHOICE }),
      ),
    );

    expect(plan).toMatchObject({
      kind: 'fallback',
      reason: 'suggestion_matches_rules',
    });
  });

  it('plans a change for a CREATE row that matches a real customer', () => {
    const plan = planImportChange(importCall(suggested('choice_1')));

    expect(plan).toMatchObject({
      kind: 'change',
      change: { row_no: 1, customer_id: CUSTOMER_CHOICE },
    });
  });

  it('keeps create_new suggestions with the rules outcome when the rules matched a customer', () => {
    const plan = planImportChange(
      importCall(
        suggested('choice_2'),
        importCase({ actualChoice: CUSTOMER_CHOICE }),
      ),
    );

    expect(plan).toMatchObject({ kind: 'fallback', reason: 'not_applicable' });
  });

  it('treats a create_new suggestion that matches the rules as suggestion_matches_rules', () => {
    const plan = planImportChange(importCall(suggested('choice_2')));

    expect(plan).toMatchObject({
      kind: 'fallback',
      reason: 'suggestion_matches_rules',
    });
  });

  it('keeps same-file candidates, which have no customer id, with the rules outcome', () => {
    const plan = planImportChange(
      importCall(
        suggested('choice_1'),
        importCase({
          candidateTargets: [{ choice: CUSTOMER_CHOICE, entityId: null }],
        }),
      ),
    );

    expect(plan).toMatchObject({ kind: 'fallback', reason: 'not_applicable' });
  });

  it('keeps rows that are not CREATE with the rules outcome', () => {
    const plan = planImportChange(
      importCall(
        suggested('choice_1'),
        importCase({
          row: { row_no: 1, action: ImportRowAction.UPDATE } as DryRunRowResult,
        }),
      ),
    );

    expect(plan).toMatchObject({ kind: 'fallback', reason: 'not_applicable' });
  });
});

describe('pairRedactedChoices', () => {
  it('pairs each redacted label with the real label at the same position', () => {
    const pairs = pairRedactedChoices(
      ['choice_1', 'choice_2'],
      [CUSTOMER_CHOICE, CREATE_NEW],
    );

    expect(pairs.get('choice_1')).toBe(CUSTOMER_CHOICE);
    expect(pairs.get('choice_2')).toBe(CREATE_NEW);
  });
});

describe('buildImportLiveDecisions', () => {
  const change = planImportChange(importCall(suggested('choice_1')));
  const fallback: ImportPlan = {
    kind: 'fallback',
    call: importCall(suggested('choice_1')),
    reason: 'timeout',
  };

  function decisionsFor(
    plans: ImportPlan[],
    tier: 'AUTO' | 'PROPOSE' | 'HUMAN_ONLY',
    write: ImportWriteState = NO_WRITE,
  ) {
    return buildImportLiveDecisions({
      tenantId: 'tenant-1',
      traceId: 'trace-1',
      jobId: 'job-1',
      tier,
      policyReasons: ['base_tier_auto'],
      providerId: 'openrouter-jev',
      plans,
      write,
    });
  }

  it('records an applied AUTO change with the customer as its target', () => {
    const [decision] = decisionsFor([change], 'AUTO', {
      ...NO_WRITE,
      appliedRowNos: new Set([1]),
    });

    expect(decision).toMatchObject({
      outcome: 'applied',
      reason: null,
      targetEntityId: CUSTOMER_CHOICE,
      entityType: 'ImportJob',
      entityId: 'job-1',
      rowNo: 1,
      redactedSuggestedChoice: 'choice_1',
    });
  });

  it('records an AUTO change that was not written as record_changed', () => {
    const [decision] = decisionsFor([change], 'AUTO');

    expect(decision).toMatchObject({
      outcome: 'fallback',
      reason: 'record_changed',
      targetEntityId: null,
    });
  });

  it('records an AUTO change whose transaction failed as apply_failed', () => {
    const [decision] = decisionsFor([change], 'AUTO', {
      ...NO_WRITE,
      applyFailed: true,
    });

    expect(decision).toMatchObject({
      outcome: 'fallback',
      reason: 'apply_failed',
    });
  });

  it('records a PROPOSE change as proposed, or as apply_failed when the proposal failed', () => {
    const [proposed] = decisionsFor([change], 'PROPOSE');
    const [failed] = decisionsFor([change], 'PROPOSE', {
      ...NO_WRITE,
      proposalFailed: true,
    });

    expect(proposed).toMatchObject({
      outcome: 'proposed',
      reason: null,
      targetEntityId: CUSTOMER_CHOICE,
    });
    expect(failed).toMatchObject({
      outcome: 'fallback',
      reason: 'apply_failed',
      targetEntityId: null,
    });
  });

  it('refuses every change under HUMAN_ONLY', () => {
    const [decision] = decisionsFor([change], 'HUMAN_ONLY');

    expect(decision).toMatchObject({
      outcome: 'refused',
      reason: 'human_only',
      targetEntityId: null,
    });
  });

  it('keeps the planned fallback reason whatever the tier', () => {
    const [decision] = decisionsFor([fallback], 'AUTO', {
      ...NO_WRITE,
      appliedRowNos: new Set([1]),
    });

    expect(decision).toMatchObject({
      outcome: 'fallback',
      reason: 'timeout',
      targetEntityId: null,
    });
  });
});
