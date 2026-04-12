---
title: "ADR-0008: Automated Architectural Governance"
date: "2026-04-12"
status: accepted
deciders: "Product Owner, Architecture Team"
linear-project: "f329327dd33f"
linear-milestone: ""
tags:
  - adr
  - governance
  - ai-agents
---

# ADR-0008: Automated Architectural Governance

## Status

**Accepted** — 2026-04-12 (Retroactive documentation)

## Context

As the Auto Core Platform grows in complexity, relying purely on human developers to remember the architectural invariants (like the Ledger Inventory model, Fiscal Lock Date checking, and rigorous UI Component abstraction) is unsustainable. PR reviews miss nuanced violations, resulting in technical debt.

We needed a way to shift governance left, directly into the IDE and the PR flow, acting as a tireless "Product Owner" that rejects structurally unsound code.

## Decision

We instituted **Automated Architectural Governance** by scaffolding a custom GitHub Copilot Extension (a stateless NestJS agent) inside the monorepo.

1. **The Vault as Ground Truth:** This Obsidian vault (`docs/internal`) serves as the single source of truth for all architectural invariants (ADRs) and component behaviors.
2. **Agent Rules (`AGENTS.md`):** We developed a centralized ruleset instructing the AI on the explicit frontend and backend logic.
3. **Automated Enforcement:** The Copilot Agent analyzes proposed PRs against the Vault and `AGENTS.md`. If a developer attempts an N+1 query loop or mutates `InventoryStock` instead of posting to the ledger, the agent rejects it.

## Consequences

### Positive
- **Instant Feedback:** Developers are corrected on framework usage (e.g., using TanStack Query key factories instead of hardcoded arrays) before the code ever hits human review.
- **Strict Compliance:** The core architectural constraints (ADR-0002 through ADR-0006) are mathematically enforced.
- **Living Documentation:** Because the agent reads directly from the vault, the documentation is guaranteed never to go stale. If an ADR rots, the agent gives bad advice, forcing developers to update the docs.

### Negative
- **Maintenance Overhead:** Building and maintaining a custom stateless NestJS agent for Copilot adds infrastructure overhead to the monorepo.
- **False Positives:** The agent requires constant "tuning" to prevent it from blocking valid exceptions to the rules.

## References

- `docs/internal/README.md`
- `AGENTS.md` (Repository Root)

---

## Linear Tracking

| Field | Value |
|-------|-------|
| Project | [Automated Architectural Governance](https://linear.app/auto-core-platform/project/automated-architectural-governance-f329327dd33f) |
| Milestone | Scaffolding |
| Issues | 6 Backlog Issues (NestJS App, REST endpoints, PR Review Agent) |
