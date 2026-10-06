# Jev vs deterministic rules evaluation

## Method

This evaluation uses the 200-row synthetic AE4 fixture set. The offline rules configuration calls the existing customer and vehicle import planners for identity matching and the existing document-sort heuristic. Jev-only evaluates every row. Rules + Jev calls Jev only when the rules classify the input as ambiguous; a confident deterministic choice remains final. Every suggestion is re-checked against the fixture's expected label, and a mismatch is scored as incorrect.

The fixture contains 12 adversarial false-completion examples per run. Each has an explicit synthetic claim that a match or completion exists while its expected label disagrees. Results include one rules baseline run, three Jev-only runs, and three rules + Jev runs. Each result is re-checked against the fixture label and choices; none of the provider calls returned an execution error.

The report generator derives all tables from JSON stored under a directory named with the fixture SHA-256. Jev table rows aggregate the three runs (N=300 per use case); run-to-run accuracy and false-completion outcomes are summarized separately below. Input-token cost uses $0.042 per million tokens; output tokens are free. Confidence 0.80 is the threshold used for confident-auto precision and recall.

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
| Jev only | all | 300 | 81.7% | 100.0% / 99.2% | 0 | 266.0 / 350.1 | n/a |
| Jev only | easy | 96 | 84.4% | 100.0% / 100.0% | 0 | 263.0 / 346.0 | n/a |
| Jev only | ambiguous | 93 | 87.1% | 100.0% / 100.0% | 0 | 266.0 / 332.8 | n/a |
| Jev only | adversarial | 111 | 74.8% | 100.0% / 97.6% | 0 | 269.0 / 371.0 | n/a |
| Jev only | false-completion | 18 | 0.0% | — / — | 0 | 265.0 / 390.7 | n/a |
| Rules + Jev | all | 300 | 81.0% | 100.0% / 100.0% | 0 | 0.0 / 306.1 | n/a |
| Rules + Jev | easy | 96 | 84.4% | 100.0% / 100.0% | 0 | 0.0 / 287.0 | n/a |
| Rules + Jev | ambiguous | 93 | 87.1% | 100.0% / 100.0% | 0 | 0.0 / 277.4 | n/a |
| Rules + Jev | adversarial | 111 | 73.0% | 100.0% / 100.0% | 0 | 0.1 / 328.5 | n/a |
| Rules + Jev | false-completion | 18 | 0.0% | — / — | 0 | 270.0 / 375.2 | n/a |

### Document sorting

| Configuration | Difficulty/tag | N | Accuracy | Confident auto P / R | Wrong Jev suggestions rules would catch | Latency p50 / p95 (ms) | Estimated input cost |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Rules only | all | 100 | 61.0% | 100.0% / 70.5% | — | 0.0 / 0.0 | $0.000000 |
| Rules only | easy | 31 | 87.1% | 100.0% / 77.8% | — | 0.0 / 0.0 | $0.000000 |
| Rules only | ambiguous | 32 | 90.6% | 100.0% / 75.9% | — | 0.0 / 0.0 | $0.000000 |
| Rules only | adversarial | 37 | 13.5% | — / 0.0% | — | 0.0 / 0.0 | $0.000000 |
| Rules only | false-completion | 6 | 0.0% | — / — | — | 0.0 / 0.2 | $0.000000 |
| Jev only | all | 300 | 81.3% | 99.5% / 80.7% | 0 | 262.5 / 345.1 | n/a |
| Jev only | easy | 93 | 100.0% | 100.0% / 83.9% | 0 | 262.0 / 359.0 | n/a |
| Jev only | ambiguous | 96 | 100.0% | 100.0% / 84.4% | 0 | 259.0 / 332.0 | n/a |
| Jev only | adversarial | 111 | 49.5% | 97.4% / 69.1% | 0 | 267.0 / 329.0 | n/a |
| Jev only | false-completion | 18 | 61.1% | 75.0% / 27.3% | 0 | 260.5 / 326.6 | n/a |
| Rules + Jev | all | 300 | 82.3% | 98.7% / 89.9% | 0 | 237.0 / 331.1 | n/a |
| Rules + Jev | easy | 93 | 100.0% | 100.0% / 100.0% | 0 | 0.0 / 286.2 | n/a |
| Rules + Jev | ambiguous | 96 | 100.0% | 100.0% / 100.0% | 0 | 0.0 / 295.3 | n/a |
| Rules + Jev | adversarial | 111 | 52.3% | 91.7% / 56.9% | 0 | 269.0 / 354.0 | n/a |
| Rules + Jev | false-completion | 18 | 66.7% | 50.0% / 25.0% | 0 | 273.5 / 352.7 | n/a |
<!-- AGENT-EVAL-TABLES:END -->

### Three-run stability and false-completion check

Accuracy and confident-auto precision are shown for runs 1/2/3. The spread is the highest minus lowest run accuracy. Each run contains 12 false-completion examples across the two use cases.

| Configuration | Use case | Accuracy by run | Accuracy spread | Confident-auto precision by run | Incorrect false-completion suggestions across both use cases by run |
| --- | --- | --- | ---: | --- | --- |
| Jev only | Import matching | 81% / 82% / 82% | 1 pp | 100% / 100% / 100% | 6/12 / 6/12 / 6/12 |
| Jev only | Document sorting | 82% / 81% / 81% | 1 pp | 100% / 98.5% / 100% | 8/12 / 8/12 / 9/12 |
| Rules + Jev | Import matching | 81% / 81% / 81% | 0 pp | 100% / 100% / 100% | 6/12 / 6/12 / 6/12 |
| Rules + Jev | Document sorting | 82% / 82% / 83% | 1 pp | 98.6% / 98.7% / 98.7% | 8/12 / 8/12 / 8/12 |

The confident-auto precision and run-spread checks pass these thresholds. The false-completion check fails in every run: Jev-only produced 6–9 incorrect suggestions out of 12, and rules + Jev produced 8/12 each run.

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

**Recommendation: stay rules-only for human-facing decisions; keep Jev in shadow evaluation for document sorting only.** Jev-only averaged 81.7% import-matching accuracy versus 100.0% for rules, and rules + Jev averaged 81.0%. For document sorting, Jev-only averaged 81.3% and rules + Jev 82.3%, compared with 61.0% for rules. These document-sorting gains do not meet the false-completion gate. Do not show Jev suggestions to a human until the following gate passes on every run:

- At least 98% precision among suggestions with confidence ≥ 0.80, with recall reported alongside it.
- Zero incorrect suggestions on the false-completion tag (0/12 per run; 0% false-completion rate).
- No more than a 2 percentage-point spread in confident-auto accuracy across the three runs.

Passing this gate authorizes a limited human-review suggestion trial only; it does not authorize automatic record matching or document completion. In these runs, Jev and rules + Jev both made incorrect suggestions on false-completion examples in every run. Rules alone was correct on 6/12 baseline examples overall, but its document-sorting false-completion result was 0/6. No configuration is ready for human-facing suggestions under this gate. Import matching should remain rules-only; document sorting can remain a Jev shadow-evaluation candidate.

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

The dataset is synthetic and small, so these numbers do not establish production performance. The OpenRouter Decisions API is alpha. These responses did not include input or output token counts, so the Jev cost estimate is unavailable. Verified-decision replay fingerprints are not included in this change; add that read-only CI replay as a separate follow-up, keeping it separate from the AE2 agent action log.
