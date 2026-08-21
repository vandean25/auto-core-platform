# Neon Pooler Secret Wiring Design

## Goal

Ensure Cloud Run runtime traffic can use a dedicated Neon `-pooler` endpoint while Prisma migrations continue using the direct `DATABASE_URL` secret.

## Constraints

- The repository cannot verify Secret Manager state because the current environment does not include `gcloud`.
- A Cloud Build substitution must not default to a GSM secret whose existence is unverified.
- Existing UAT deployments must continue to start until the operator creates and wires the pooled secret.
- No real database URLs or secret values may be committed.

## Design

### Cloud Build

Keep `_DATABASE_SECRET` and the `migrate-db` step unchanged so migrations receive only the direct `DATABASE_URL`. Keep the currently deployable pooled substitution default until the operator confirms `acp-core-api-database-url-pooled` exists, and document that staging and production overrides must use that dedicated secret before the first pooler deploy. Cloud Run will continue to receive both `DATABASE_URL` and `DATABASE_URL_POOLED`; the latter is the runtime-only input.

### Startup diagnostics

Add a small pure diagnostic module beside the runtime URL resolver. It parses only URL hostnames, never logs credentials or complete URLs, and reports:

- whether a pooled URL is configured;
- the direct and pooled hostnames;
- whether the pooled hostname contains `-pooler`;
- whether the pooled hostname equals the direct hostname;
- whether `DATABASE_POOLER_REQUIRED=true` is active.

At startup, emit one JSON log event. Production emits a warning when the pooled endpoint is missing, is not a `-pooler` host, or equals the direct host; other environments emit an informational event. If production sets `DATABASE_POOLER_REQUIRED=true`, throw a configuration error for any of those mismatch conditions. The default remains non-fatal.

### Environment documentation

Document `DATABASE_POOLER_REQUIRED` in the API environment example and validation key list. It is an optional string flag, defaulting to disabled, and should only be enabled after the operator verifies the pooled Neon secret and SQL evidence.

### Operations documentation

Update the runbook and GSM guide with:

- the dedicated pooled secret name and operator prerequisite;
- the fact that the repository intentionally does not verify or default to an unconfirmed GSM secret;
- the four alert definitions as Cloud Monitoring PromQL/MQL starting points;
- honest verification checkboxes distinguishing code complete from operator-complete;
- the direct migration URL invariant.

## Testing

Use TDD for the new diagnostic behavior:

1. Test distinct direct and pooled Neon hosts, including `-pooler` detection.
2. Test equal hosts and missing/blank pooled values as mismatches.
3. Test that production enforcement is disabled by default and throws only when `DATABASE_POOLER_REQUIRED=true`.
4. Test structured logging uses `warn` in production for a mismatch and never includes URL credentials.
5. Run the existing runtime URL, shared pool, Prisma service, and environment specs, followed by backend lint and build.
