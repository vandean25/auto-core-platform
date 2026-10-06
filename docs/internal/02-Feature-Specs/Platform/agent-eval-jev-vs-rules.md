# Jev vs deterministic rules evaluation

## Method

This evaluation uses the 200-row synthetic AE4 fixture set. The offline rules configuration calls the existing customer and vehicle import planners for identity matching and the existing document-sort heuristic. Jev-only evaluates every row. Rules + Jev calls Jev only when the rules classify the input as ambiguous; a confident deterministic choice remains final. Every suggestion is re-checked against the fixture's expected label, and a mismatch is scored as incorrect.

The fixture contains 12 adversarial false-completion examples. Each has an explicit synthetic claim that a match or completion exists while its expected label disagrees. The committed results include rules only because `OPENROUTER_API_KEY` was not configured for this run. Jev-only and rules + Jev are marked pending until three runs of each are recorded.

The report generator derives all tables from JSON stored under a directory named with the fixture SHA-256. Input-token cost uses $0.042 per million tokens; output tokens are free. Confidence 0.80 is the threshold used for confident-auto precision and recall.

## Results

<!-- AGENT-EVAL-TABLES:START -->
Dataset SHA-256: `e0454fcc80688e21b18f7c4e2777cba2abfff2ad2897ba88bbd6f90095a84379`.

Confident auto uses confidence ≥ 0.80. Precision is the correct share of confident suggestions; recall is the share of all correct examples that were confidently suggested. “Wrong Jev suggestions rules would catch” counts incorrect Jev choices where the rules choice is correct and has confidence ≥ 0.80. Cost uses input tokens at $0.042 per million; output tokens are free.

### Import row matching

| Configuration | Difficulty/tag | N | Accuracy | Confident auto P / R | Wrong Jev suggestions rules would catch | Latency p50 / p95 (ms) | Estimated input cost |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Rules only | all | 100 | 100.0% | 100.0% / 81.0% | — | 0.0 / 0.1 | $0.000000 |
| Rules only | easy | 32 | 100.0% | 100.0% / 84.4% | — | 0.0 / 0.1 | $0.000000 |
| Rules only | ambiguous | 31 | 100.0% | 100.0% / 87.1% | — | 0.0 / 0.0 | $0.000000 |
| Rules only | adversarial | 37 | 100.0% | 100.0% / 73.0% | — | 0.0 / 0.1 | $0.000000 |
| Rules only | false-completion | 6 | 100.0% | — / 0.0% | — | 0.0 / 0.5 | $0.000000 |
| Jev only | all | pending run | — | — | — | — | — |
| Jev only | easy | pending run | — | — | — | — | — |
| Jev only | ambiguous | pending run | — | — | — | — | — |
| Jev only | adversarial | pending run | — | — | — | — | — |
| Jev only | false-completion | pending run | — | — | — | — | — |
| Rules + Jev | all | pending run | — | — | — | — | — |
| Rules + Jev | easy | pending run | — | — | — | — | — |
| Rules + Jev | ambiguous | pending run | — | — | — | — | — |
| Rules + Jev | adversarial | pending run | — | — | — | — | — |
| Rules + Jev | false-completion | pending run | — | — | — | — | — |

### Document sorting

| Configuration | Difficulty/tag | N | Accuracy | Confident auto P / R | Wrong Jev suggestions rules would catch | Latency p50 / p95 (ms) | Estimated input cost |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Rules only | all | 100 | 61.0% | 100.0% / 70.5% | — | 0.0 / 0.0 | $0.000000 |
| Rules only | easy | 31 | 87.1% | 100.0% / 77.8% | — | 0.0 / 0.0 | $0.000000 |
| Rules only | ambiguous | 32 | 90.6% | 100.0% / 75.9% | — | 0.0 / 0.0 | $0.000000 |
| Rules only | adversarial | 37 | 13.5% | — / 0.0% | — | 0.0 / 0.0 | $0.000000 |
| Rules only | false-completion | 6 | 0.0% | — / — | — | 0.0 / 0.2 | $0.000000 |
| Jev only | all | pending run | — | — | — | — | — |
| Jev only | easy | pending run | — | — | — | — | — |
| Jev only | ambiguous | pending run | — | — | — | — | — |
| Jev only | adversarial | pending run | — | — | — | — | — |
| Jev only | false-completion | pending run | — | — | — | — | — |
| Rules + Jev | all | pending run | — | — | — | — | — |
| Rules + Jev | easy | pending run | — | — | — | — | — |
| Rules + Jev | ambiguous | pending run | — | — | — | — | — |
| Rules + Jev | adversarial | pending run | — | — | — | — | — |
| Rules + Jev | false-completion | pending run | — | — | — | — | — |
<!-- AGENT-EVAL-TABLES:END -->

## Ten notable rules failures

These are synthetic document-sort rows from the committed rules run. “Expected” is the label; “Rules” is the deterministic suggestion.

| Example | Difficulty/tag | Expected | Rules |
| --- | --- | --- | --- |
| `doc-000` | false-completion | Sonstiges | Rechnung |
| `doc-001` | adversarial | Lieferschein | Rechnung |
| `doc-004` | false-completion | Sonstiges | Rechnung |
| `doc-005` | easy | Rechnung | Sonstiges |
| `doc-007` | adversarial | Kostenvoranschlag | Rechnung |
| `doc-013` | adversarial | Fahrzeugschein | Rechnung |
| `doc-015` | ambiguous | Rechnung | Sonstiges |
| `doc-016` | adversarial | Lieferschein | Rechnung |
| `doc-017` | false-completion | Sonstiges | Rechnung |
| `doc-019` | false-completion | Sonstiges | Rechnung |

## Recommendation and go/no-go

**Recommendation: stay rules-only for now.** Jev has not been evaluated against this fixture yet. Do not show Jev suggestions to a human until three Jev-only and three rules + Jev runs are recorded and the following gate passes on every run:

- At least 98% precision among suggestions with confidence ≥ 0.80, with recall reported alongside it.
- Zero incorrect suggestions on the false-completion tag (0/12 per run; 0% false-completion rate).
- No more than a 2 percentage-point spread in confident-auto accuracy across the three runs.

Passing this gate authorizes a limited human-review suggestion trial only; it does not authorize automatic record matching or document completion. The current rules baseline is correct on 6/12 false-completion examples (50.0%) across both use cases and fails the zero-error gate, so it is not acceptable for human-facing suggestions.

Laya/Von: **not evaluated**.

## Reproduction

From the repository root, with the key already set in the local shell environment for Jev commands:

```powershell
npm run agent-eval --workspace=core-api -- --mode=rules
npm run agent-eval --workspace=core-api -- --mode=jev --runs=3
npm run agent-eval --workspace=core-api -- --mode=rules+jev --runs=3
npm run agent-eval:report
```

The `agent-eval` command defaults to offline rules mode. Jev runs require `OPENROUTER_API_KEY` in the local environment; the key is never written to results. The committed report can be reproduced without a key by running only `npm run agent-eval:report`.

## Caveats and follow-up

The dataset is synthetic and small, so these numbers do not establish production performance. The OpenRouter Decisions API is alpha, and token usage may be absent from a response; in that case the Jev cost estimate is shown as unavailable. Verified-decision replay fingerprints are not included in this change; add that read-only CI replay as a separate follow-up, keeping it separate from the AE2 agent action log.
