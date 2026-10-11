import * as Sentry from '@sentry/node';

/**
 * Sentry tag that carries the app-level trace id (`x-trace-id`, persisted as `AgentActionLog.trace_id`).
 * Searching Sentry for this tag finds the request, and searching the action log finds the same id.
 */
export const APP_TRACE_ID_TAG = 'app.trace_id';

const MAX_STRING_ATTRIBUTE_LENGTH = 200;

/**
 * Attributes leave the process for an external service, so keys that name personal data or document
 * content are dropped here even if a caller passes one by mistake. Callers still pass only IDs and enums.
 */
const SENSITIVE_ATTRIBUTE_KEY =
  /email|phone|iban|bic|name|address|token|secret|password|authorization|cookie|prompt|content|excerpt|text|body|payload|note/i;

const KB = 1024;
const MB = 1024 * KB;
const BYTE_SIZE_BUCKETS: ReadonlyArray<
  readonly [limit: number, label: string]
> = [
  [100 * KB, 'lt_100kb'],
  [MB, '100kb_1mb'],
  [5 * MB, '1mb_5mb'],
  [10 * MB, '5mb_10mb'],
];

export type SpanAttributeValue = string | number | boolean;

export type SpanAttributes = Record<string, unknown>;

/** The subset of a span that callers may write to. Values pass the same filter as `withSpan` attributes. */
export type SpanHandle = {
  setAttribute(key: string, value: unknown): void;
  setAttributes(attributes: SpanAttributes): void;
};

const NOOP_SPAN: SpanHandle = {
  setAttribute: () => undefined,
  setAttributes: () => undefined,
};

function toSafeEntry(
  key: string,
  value: unknown,
): [string, SpanAttributeValue] | undefined {
  if (SENSITIVE_ATTRIBUTE_KEY.test(key)) return undefined;
  if (typeof value === 'string') {
    return [key, value.slice(0, MAX_STRING_ATTRIBUTE_LENGTH)];
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? [key, value] : undefined;
  }
  if (typeof value === 'boolean') return [key, value];
  return undefined;
}

/** Keeps finite numbers, booleans and short strings. Objects, arrays, functions, null and sensitive keys are dropped. */
export function sanitizeSpanAttributes(
  attributes: SpanAttributes,
): Record<string, SpanAttributeValue> {
  const safe: Record<string, SpanAttributeValue> = {};
  for (const [key, value] of Object.entries(attributes)) {
    const entry = toSafeEntry(key, value);
    if (entry) safe[entry[0]] = entry[1];
  }
  return safe;
}

function isSentryActive(): boolean {
  return Sentry.getClient() !== undefined;
}

function toSpanHandle(span: Sentry.Span): SpanHandle {
  return {
    setAttribute: (key, value) => {
      const entry = toSafeEntry(key, value);
      if (entry) span.setAttribute(entry[0], entry[1]);
    },
    setAttributes: (attributes) => {
      const safe = sanitizeSpanAttributes(attributes);
      if (Object.keys(safe).length > 0) span.setAttributes(safe);
    },
  };
}

/**
 * Runs `fn` inside a Sentry span. Without an initialised Sentry client it calls `fn` directly, so
 * local runs and tests behave exactly as before. Attributes are filtered on the way in and on every write.
 */
export function withSpan<T>(
  name: string,
  op: string,
  attributes: SpanAttributes,
  fn: (span: SpanHandle) => T,
): T {
  if (!isSentryActive()) {
    return fn(NOOP_SPAN);
  }
  return Sentry.startSpan(
    { name, op, attributes: sanitizeSpanAttributes(attributes) },
    (span) => fn(toSpanHandle(span)),
  );
}

/** Runs `fn` in a span and records `status` as `ok` or `failed` before any error is rethrown. */
export function withStatusSpan<T>(
  name: string,
  op: string,
  attributes: SpanAttributes,
  fn: (span: SpanHandle) => Promise<T>,
): Promise<T> {
  return withSpan(name, op, attributes, async (span) => {
    try {
      const result = await fn(span);
      span.setAttribute('status', 'ok');
      return result;
    } catch (error) {
      span.setAttribute('status', 'failed');
      throw error;
    }
  });
}

/** Adds attributes to the span that is active now, such as the request span that wrote an action log row. */
export function setActiveSpanAttributes(attributes: SpanAttributes): void {
  if (!isSentryActive()) return;
  const safe = sanitizeSpanAttributes(attributes);
  if (Object.keys(safe).length === 0) return;
  Sentry.getActiveSpan()?.setAttributes(safe);
}

/**
 * The Sentry trace id of the active span. Falls back to the scope's propagation context when tracing is
 * sampled out, so the id is still present for log correlation.
 */
export function getActiveTraceId(): string | undefined {
  if (!isSentryActive()) return undefined;
  const activeSpan = Sentry.getActiveSpan();
  if (activeSpan) return activeSpan.spanContext().traceId;
  return Sentry.getCurrentScope().getPropagationContext().traceId;
}

/**
 * `sentry-trace` and `baggage` headers for the current trace. Used on outbound hops that leave the
 * request, such as Cloud Tasks, so the worker's span joins the same Sentry trace.
 */
export function getSentryTraceHeaders(): Record<string, string> {
  if (!isSentryActive()) return {};
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(Sentry.getTraceData())) {
    if (typeof value === 'string') headers[name] = value;
  }
  return headers;
}

/** Tags the request's isolation scope with the app trace id, so Sentry events and traces carry it. */
export function linkAppTraceIdToSentry(appTraceId: string): void {
  if (!isSentryActive()) return;
  Sentry.getIsolationScope().setTag(APP_TRACE_ID_TAG, appTraceId);
}

/** Coarse size bucket for a document or upload. Exact sizes are not recorded. */
export function toByteSizeBucket(byteLength: number): string {
  if (!Number.isFinite(byteLength) || byteLength < 0) return 'unknown';
  const bucket = BYTE_SIZE_BUCKETS.find(([limit]) => byteLength < limit);
  return bucket ? bucket[1] : 'gte_10mb';
}
