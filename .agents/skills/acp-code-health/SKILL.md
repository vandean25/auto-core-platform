---
name: acp-code-health
description: Use when the CI check "Code Health (Fallow)" fails on a PR, or before pushing a change that adds or reshapes source files.
---

# Code health gate (Fallow)

`Code Health (Fallow)` runs `fallow audit` (`.github/workflows/build.yaml`, config `.fallowrc.json`). It checks only the files the PR changes and fails only on findings the PR **introduces**: unused files or exports, functions above the complexity limits (cyclomatic 20, cognitive 15), new duplication, new suppression comments and weakened tests. Inherited findings are shown as context and never fail the check. The check status is the result.

## Loop (keep it short)

1. Optional: one local run before pushing: `npx fallow audit` (takes seconds; base is the merge base with `origin/main`).
2. Push and read the CI result once: job summary or annotations of `Code Health (Fallow)`.
3. Red? One fix round on the real cause, push once more.
4. Still red? Stop. Write in the PR what fails and why a fix is out of scope. A human decides; only a human adds the `gate-override` label and re-runs the job.

## Never

- Rename or split files, add stubs or re-export shims, or move code just to change what the gate sees.
- Add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `fallow-ignore` or `.skip` to pass. New suppressions and weakened tests are gate errors.
- Edit `.fallowrc.json`, the workflow, ESLint configs or `CODEOWNERS`. Config changes need Dejan's OK in a separate PR.
- Delete code you did not touch to "clean up" inherited findings in the same PR.

## Reviewers

Do not repeat findings the gate reports. Only judge whether a gate fix is a real improvement or cosmetic.
