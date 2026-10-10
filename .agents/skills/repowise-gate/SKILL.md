---
name: repowise-gate
description: Use when the CI check "Repowise Health Gate" fails, when `npm run repowise:gate` reports violations, or before editing a large or legacy source file. Explains how to read the gate report and fix scores without weakening the gate.
---

# Repowise Health Gate (AUT-462)

The required CI check `Repowise Health Gate` (job `repowise-health-gate` in `.github/workflows/build.yaml`) compares repowise health scores (0-10) of the files a PR touches against the base branch. Implementation: `tools/repowise-gate.mjs` (git and repowise I/O) and `tools/repowise-gate-lib.mjs` (rules and messages).

## When to use this skill
- The check `Repowise Health Gate` is red.
- `npm run repowise:gate` prints `Repowise health gate FAILED`.
- You are about to edit a large or legacy file (see the list at the end).

## Rules
1. A changed source file must not score lower than on the base branch (compared at two decimals).
2. A new source file must score at least 6.0.
3. Legacy files below 6.0 are listed in `.repowise-baseline.json` (`{"version":1,"files":{"path": score}}`). For every changed file the entry must equal the head score. Healthy files (>= 6.0), deleted files and the old path of a rename must not be listed.

Gated: `.ts .tsx .mts .cts .js .jsx .mjs .cjs`. Not gated: `*.d.ts`, `docs/`, `.agents/`, and paths containing `node_modules`, `dist`, `coverage`, `generated` or `.repowise`.

## Run locally
```bash
git fetch origin main
npm run repowise:gate -- --base origin/main   # check; needs uv/uvx, scores base and head, takes a few minutes
npm run repowise:gate -- --update             # sync .repowise-baseline.json, only when no code violation is open
npm run repowise:gate:test                    # unit tests of the gate itself
```
Exit codes: `0` passed (or no gated file changed), `1` violations (or `--update` refused), `2` usage or setup error (for example `uvx` missing, `unknown base ref: ...`, invalid baseline). Errors print as `repowise health gate: <message>`.

The gate looks at committed, uncommitted and untracked changes against the merge base with `--base`.

## Reading the report
Each code violation looks like this:
```
  ✖ path/to/file.ts
      before 7.10 -> after 6.80
      score decreased; changed files must not get worse
```
Baseline problems look like this:
```
  ✖ path/to/legacy.ts (.repowise-baseline.json)
      baseline lists 4.59 but the head scores 4.70; run `npm run repowise:gate -- --update` and commit .repowise-baseline.json
```

| Kind | Message | Meaning and fix |
|---|---|---|
| `worse` | `score decreased; changed files must not get worse` | The file scores lower than on base. Fix in code (playbook below). Not fixable via the baseline. |
| `below-floor` | `dropped below the 6.0 floor; healthy files must stay at or above it` | The file was >= 6.0 and is now below. Same as `worse`: refactor or split. |
| `new-below-floor` | `new source files must score at least 6.0` | New file (before shows `none (new file)`). Simplify or split it. New files are never baselined. A renamed file is compared with its old path first. |
| `lost-score` | `repowise no longer scores this file, so the gate cannot check it; keep it in a scored path` | The file had a score on base but has none now (after is `none (not scored)`). Keep it in a scored path and file type. |
| `baseline-stale` | `legacy file is not listed in the baseline`, `baseline lists X but the head scores Y`, or `deleted, renamed or healthy files must leave the baseline` | `.repowise-baseline.json` is out of sync. Fix code violations first, then run `npm run repowise:gate -- --update` and commit the file. |

A final section `Not scored by repowise (skipped, not gated)` lists new files repowise did not score. That is informational, not a failure.

## Fix playbook
1. Put new logic into a NEW file (helper, mapper, constants) instead of growing a large file.
2. Move test fixtures and support code into `*.spec.support.ts` or a separate spec file. Split long specs by topic.
3. Move types into their own type file instead of extending `api/types.ts` and similar files.
4. Reduce nesting and branching: early returns, small functions, lookup tables.
5. Re-measure with `npm run repowise:gate -- --base origin/main` (or `npm run repowise:health`) until there are no code violations.
6. Only then run `npm run repowise:gate -- --update` if the baseline needs to follow (a legacy file improved, or a legacy file you touched was not listed yet). Commit `.repowise-baseline.json`.

`--update` refuses while any code violation is open (`Baseline not updated: fix the code violations above first.`), so it can never approve a regression. It only adds, updates or removes entries for files touched by the change.

## Do not
- Do not weaken the gate: no tolerances or lower thresholds in the scripts, no `continue-on-error`, no removing or making the job advisory, no excluding paths to dodge a score.
- Do not edit `.repowise-baseline.json` by hand, and never lower or invent a value. Only `--update` writes it.
- Do not refactor unrelated code. Do just enough to reach a score that is not worse than base (and >= 6.0 for new files).
- Do not refactor a huge file only to avoid a baseline entry. A baseline entry via `--update` is fine as long as the file did not get worse.

## Known large files (extract helpers first, then change)
`TaskLineItemEditor`, `WorkshopOrderDetails`, `InvoiceDraftEditPage`, `GlobalSearch`, `apps/core-api/src/app.module.ts`, `App.tsx`, `api/types.ts`.

## PR description template
```
## Repowise
| File | before (main) | after | Baseline |
|---|---|---|---|
| path/a.ts | 9.85 | 9.85 | - |
| path/new.ts | new | 7.10 | - |
| path/legacy.ts | 4.59 | 4.70 | 4.70 (--update) |
Gate locally: `npm run repowise:gate -- --base origin/main` -> passed
Extracted: <which helpers/files>
```
