import { BadRequestException } from '@nestjs/common';
import type { AgentPolicyEvaluateContext } from '../agent-policy/agent-policy.types.js';
import { resolveLineItemFinancials } from './agent-proposal-financials.js';
import {
  isPlainRecord,
  isWorkshopOrderLineAction,
} from './agent-proposal-payload.js';

/** Accepted payload keys for the policy amount, with the divisor that converts each to EUR. */
const AMOUNT_EUR_FIELDS: ReadonlyArray<
  readonly [key: string, divisor: number]
> = [
  ['amount_eur', 1],
  ['amountEur', 1],
  ['amount', 1],
  ['amount_cents', 100],
  ['amountCents', 100],
];

/** Maps an agent payload to the policy evaluation context for the given action. */
export function extractPolicyContext(
  payload: unknown,
  actionType?: string,
): AgentPolicyEvaluateContext {
  if (!isPlainRecord(payload)) {
    return {};
  }
  const context: AgentPolicyEvaluateContext = {
    ...readPolicyAmount(payload, actionType),
    ...readPolicyFlags(payload),
  };

  if (isPlainRecord(payload.context)) {
    const nested = extractPolicyContext(payload.context, actionType);
    return { ...nested, ...context };
  }

  return context;
}

function readPolicyAmount(
  record: Record<string, unknown>,
  actionType?: string,
): AgentPolicyEvaluateContext {
  if (actionType && isWorkshopOrderLineAction(actionType)) {
    const lineItem = record.line_item;
    const policyRecord = isPlainRecord(lineItem)
      ? { ...record, ...lineItem }
      : record;
    return { amount_eur: resolveLineItemFinancials(policyRecord).totalAmount };
  }

  const amountEur = readAmountEur(record);
  if (amountEur === undefined) {
    return {};
  }
  if (amountEur < 0) {
    throw new BadRequestException('Amount cannot be negative');
  }
  return { amount_eur: amountEur };
}

function readPolicyFlags(
  record: Record<string, unknown>,
): AgentPolicyEvaluateContext {
  const flags: AgentPolicyEvaluateContext = {};

  const customerFacing = readBoolean(record, [
    'customer_facing',
    'customerFacing',
  ]);
  if (customerFacing !== undefined) {
    flags.customer_facing = customerFacing;
  }

  const reversible = readBoolean(record, ['reversible']);
  if (reversible !== undefined) {
    flags.reversible = reversible;
  }

  const affectsLegal = readBoolean(record, [
    'affects_legal_document',
    'affectsLegalDocument',
  ]);
  if (affectsLegal !== undefined) {
    flags.affects_legal_document = affectsLegal;
  }

  return flags;
}

function readAmountEur(record: Record<string, unknown>): number | undefined {
  for (const [key, divisor] of AMOUNT_EUR_FIELDS) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value / divisor;
    }
  }
  return undefined;
}

function readBoolean(
  record: Record<string, unknown>,
  keys: readonly string[],
): boolean | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') {
      return value;
    }
  }
  return undefined;
}
