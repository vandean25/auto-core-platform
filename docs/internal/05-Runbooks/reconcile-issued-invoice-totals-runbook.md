# Runbook: Reconcile Issued Invoice Stored Totals (AUT-822)

## Purpose
Repairs already-issued invoices (`ISSUED` / `FINALIZED`) whose stored `invoices.total_net`, `invoices.total_tax`, or `invoices.total_gross` differ from the authoritative immutable `snapshot` totals due to pre-AUT-822 rounding differences.

## Execution Rules
- **QA:** Infra runs this script against QA.
- **Production:** Requires **Dejan's explicit approval** before running with `--apply`.
- **Coding agents:** Never run this script against QA or production.

## Usage

Dry-run (default — lists mismatched invoices with `id`, `number`, `tenant`, `stored`, `snapshot`, `diff` and makes no changes):
```bash
npm run invoices:reconcile-totals --workspace=core-api
# Optional tenant scope:
npm run invoices:reconcile-totals --workspace=core-api -- --tenant-id <TENANT_UUID>
```

Apply (updates `total_net`, `total_tax`, `total_gross` from `snapshot` in a tenant-scoped, idempotent manner):
```bash
npm run invoices:reconcile-totals --workspace=core-api -- --apply
# Optional tenant scope:
npm run invoices:reconcile-totals --workspace=core-api -- --apply --tenant-id <TENANT_UUID>
```

Re-running in dry-run after `--apply` must report `mismatches: []` and `updated: 0`.
