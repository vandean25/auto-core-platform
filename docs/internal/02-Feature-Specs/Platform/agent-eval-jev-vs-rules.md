# Jev vs deterministic rules evaluation

## Method

This evaluation uses the 200-row synthetic AE4 fixture set. The offline rules configuration calls the existing customer and vehicle import planners for identity matching and the existing document-sort heuristic. Jev-only evaluates every row. Rules + Jev calls Jev only when the rules classify the input as ambiguous; a confident deterministic choice remains final. Every suggestion is re-checked against the fixture's expected label, and a mismatch is scored as incorrect.

The fixture contains 12 adversarial false-completion examples per run. Each has an explicit synthetic claim that a match or completion exists while its expected label disagrees. Results include one rules baseline run, three Jev-only runs, and three rules + Jev runs. Each result is re-checked against the fixture label and choices; none of the provider calls returned an execution error.

The report generator derives all tables from JSON stored under a directory named with the fixture SHA-256. Jev table rows aggregate the three runs (N=300 per use case); run-to-run accuracy and false-completion outcomes are generated from the same result JSON. Input-token cost uses $0.042 per million tokens; output tokens are free. When provider usage is missing, serialized decision input is estimated at about four characters per token and the cost is marked `(est.)`. Confidence 0.80 is the threshold used for confident-auto precision and recall.

## Results

<!-- AGENT-EVAL-TABLES:START -->
Dataset SHA-256: `e0454fcc80688e21b18f7c4e2777cba2abfff2ad2897ba88bbd6f90095a84379`.

Confident auto uses confidence ≥ 0.80. Precision is the correct share of confident suggestions; recall is the share of all correct examples that were confidently suggested. “Wrong Jev suggestions rules would catch” counts incorrect Jev choices where the rules choice is correct and has confidence ≥ 0.80. Cost uses input tokens at $0.042 per million; output tokens are free. When provider usage is missing, serialized decision input is estimated at about four characters per token and the cost is marked (est.).

### Import row matching

| Configuration | Difficulty/tag | N | Accuracy | Confident auto P / R | Wrong Jev suggestions rules would catch | Latency p50 / p95 (ms) | Estimated input cost |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Rules only | all | 100 | 100.0% | 100.0% / 81.0% | — | 0.0 / 0.1 | $0.000000 |
| Rules only | easy | 32 | 100.0% | 100.0% / 84.4% | — | 0.0 / 0.1 | $0.000000 |
| Rules only | ambiguous | 31 | 100.0% | 100.0% / 87.1% | — | 0.0 / 0.0 | $0.000000 |
| Rules only | adversarial | 37 | 100.0% | 100.0% / 73.0% | — | 0.0 / 0.1 | $0.000000 |
| Rules only | false-completion | 6 | 100.0% | — / 0.0% | — | 0.0 / 0.5 | $0.000000 |
| Jev only | all | 300 | 81.7% | 100.0% / 99.2% | 0 | 266.0 / 350.1 | $0.002460 (est.) |
| Jev only | easy | 96 | 84.4% | 100.0% / 100.0% | 0 | 263.0 / 346.0 | $0.000787 (est.) |
| Jev only | ambiguous | 93 | 87.1% | 100.0% / 100.0% | 0 | 266.0 / 332.8 | $0.000763 (est.) |
| Jev only | adversarial | 111 | 74.8% | 100.0% / 97.6% | 0 | 269.0 / 371.0 | $0.000910 (est.) |
| Jev only | false-completion | 18 | 0.0% | — / — | 0 | 265.0 / 390.7 | $0.000147 (est.) |
| Rules + Jev | all | 300 | 81.0% | 100.0% / 100.0% | 0 | 0.0 / 306.1 | $0.000464 (est.) |
| Rules + Jev | easy | 96 | 84.4% | 100.0% / 100.0% | 0 | 0.0 / 287.0 | $0.000123 (est.) |
| Rules + Jev | ambiguous | 93 | 87.1% | 100.0% / 100.0% | 0 | 0.0 / 277.4 | $0.000098 (est.) |
| Rules + Jev | adversarial | 111 | 73.0% | 100.0% / 100.0% | 0 | 0.1 / 328.5 | $0.000243 (est.) |
| Rules + Jev | false-completion | 18 | 0.0% | — / — | 0 | 270.0 / 375.2 | $0.000147 (est.) |

### Document sorting

| Configuration | Difficulty/tag | N | Accuracy | Confident auto P / R | Wrong Jev suggestions rules would catch | Latency p50 / p95 (ms) | Estimated input cost |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Rules only | all | 100 | 61.0% | 100.0% / 70.5% | — | 0.0 / 0.0 | $0.000000 |
| Rules only | easy | 31 | 87.1% | 100.0% / 77.8% | — | 0.0 / 0.0 | $0.000000 |
| Rules only | ambiguous | 32 | 90.6% | 100.0% / 75.9% | — | 0.0 / 0.0 | $0.000000 |
| Rules only | adversarial | 37 | 13.5% | — / 0.0% | — | 0.0 / 0.0 | $0.000000 |
| Rules only | false-completion | 6 | 0.0% | — / — | — | 0.0 / 0.2 | $0.000000 |
| Jev only | all | 300 | 81.3% | 99.5% / 80.7% | 0 | 262.5 / 345.1 | $0.001558 (est.) |
| Jev only | easy | 93 | 100.0% | 100.0% / 83.9% | 0 | 262.0 / 359.0 | $0.000470 (est.) |
| Jev only | ambiguous | 96 | 100.0% | 100.0% / 84.4% | 0 | 259.0 / 332.0 | $0.000485 (est.) |
| Jev only | adversarial | 111 | 49.5% | 97.4% / 69.1% | 0 | 267.0 / 329.0 | $0.000603 (est.) |
| Jev only | false-completion | 18 | 61.1% | 75.0% / 27.3% | 0 | 260.5 / 326.6 | $0.000098 (est.) |
| Rules + Jev | all | 300 | 82.3% | 98.7% / 89.9% | 0 | 237.0 / 331.1 | $0.000903 (est.) |
| Rules + Jev | easy | 93 | 100.0% | 100.0% / 100.0% | 0 | 0.0 / 286.2 | $0.000150 (est.) |
| Rules + Jev | ambiguous | 96 | 100.0% | 100.0% / 100.0% | 0 | 0.0 / 295.3 | $0.000150 (est.) |
| Rules + Jev | adversarial | 111 | 52.3% | 91.7% / 56.9% | 0 | 269.0 / 354.0 | $0.000603 (est.) |
| Rules + Jev | false-completion | 18 | 66.7% | 50.0% / 25.0% | 0 | 273.5 / 352.7 | $0.000098 (est.) |

### Three-run stability and false-completion check

Confident-auto accuracy is measured only among suggestions with confidence ≥ 0.80; spread is the highest minus lowest run value. False-completion counts show incorrect suggestions over the tagged examples in each run: per-use-case denominators are /6 and combined denominators are /12.

| Configuration | Use case | Run 1 confident-auto accuracy | Run 2 confident-auto accuracy | Run 3 confident-auto accuracy | Confident-auto accuracy spread | False-completion incorrect / run |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Jev only | Import row matching | 100.0% | 100.0% | 100.0% | 0.0 pp | 6/6 / 6/6 / 6/6 |
| Jev only | Document sorting | 100.0% | 98.5% | 100.0% | 1.5 pp | 2/6 / 2/6 / 3/6 |
| Jev only | Both use cases | — | — | — | — | 8/12 / 8/12 / 9/12 |
| Rules + Jev | Import row matching | 100.0% | 100.0% | 100.0% | 0.0 pp | 6/6 / 6/6 / 6/6 |
| Rules + Jev | Document sorting | 98.6% | 98.7% | 98.7% | 0.0 pp | 2/6 / 2/6 / 2/6 |
| Rules + Jev | Both use cases | — | — | — | — | 8/12 / 8/12 / 8/12 |
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

The dataset is synthetic and small, so these numbers do not establish production performance. The OpenRouter Decisions API is alpha. These responses did not include input or output token counts; reported costs therefore use the serialized-input estimate and are marked `(est.)`. Verified-decision replay fingerprints are not included in this change; add that read-only CI replay as a separate follow-up, keeping it separate from the AE2 agent action log.
