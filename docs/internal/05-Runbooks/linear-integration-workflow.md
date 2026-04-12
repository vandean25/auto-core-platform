---
title: "Linear Integration Workflow"
date: "2026-04-12"
tags:
  - runbook
  - linear
  - workflow
---

# Linear Integration Workflow

This runbook documents how Feature Specs in the Obsidian vault sync with Linear for execution tracking.

---

## Overview

| Artifact | Lives In | Purpose |
|----------|----------|---------|
| **Feature Spec** | `docs/internal/02-Feature-Specs/<Module>/` | The *what* and *why* — impact analysis, acceptance criteria, architectural compliance |
| **ADR** | `docs/internal/01-ADR/` | Architectural decisions behind a feature |
| **Linear Project** | Linear workspace | Execution shell — groups milestones and issues |
| **Linear Milestone** | Linear workspace | Phased delivery gate |
| **Linear Issue** | Linear workspace | Single assignable unit of work |

**Sync direction:** Vault → Linear (one-way). The vault is the source of truth for *design*; Linear is the source of truth for *execution status*.

---

## Workflow Steps

### 1. Feature Request Intake

A new feature starts as a conversation. The Product Owner (PO) restates the request and asks clarifying questions before writing anything.

### 2. Draft Feature Spec

The PO creates a Feature Spec in the vault:

```
docs/internal/02-Feature-Specs/<Module>/<feature-name>.md
```

Using the template at `templates/Feature Spec.md`. Every section must be filled — especially **Database Impact**, **API Contract Changes**, and **UX Compliance**.

### 3. Review & Approve

The stakeholder reviews the spec. The PO iterates until approved. The `status` frontmatter field moves from `draft` → `approved`.

### 4. Create Linear Project

```bash
linear project create \
  -n "Project Name" \
  -t AUT \
  -l @me \
  -s planned \
  -j
```

Save the returned `slug` — you'll need it for milestones and issue `--project` flags.

### 5. Create Milestones

Break the project into delivery phases:

```bash
linear milestone create \
  --project <project-slug> \
  --name "Phase Name" \
  --target-date 2026-MM-DD
```

### 6. Create Issues

Write a markdown description file for each issue:

```bash
# Write the description to .linear-drafts/
# (this directory is gitignored)
```

Then create the issue:

```bash
linear issue create \
  -t "DB-1: Description of the work" \
  --project "Project Name" \
  --milestone "Phase Name" \
  -l database -l schema \
  -p 2 \
  --description-file docs/internal/.linear-drafts/issue-db1.md \
  --team AUT \
  --no-interactive
```

### 7. Update Feature Spec

After creating Linear issues, update the Feature Spec's frontmatter and tracking section:

```yaml
---
linear-project: "<project-slug>"
linear-milestone: "Phase Name"
---
```

And the bottom section:

```markdown
## Linear Tracking

| Field | Value |
|-------|-------|
| Project | [Project Name](https://linear.app/auto-core-platform/project/...) |
| Milestone | Phase Name |
| Issues | AUT-55, AUT-56, AUT-57 |
```

### 8. Assign & Execute

Assign issues to coding agents or team members:

```bash
linear issue update AUT-55 --assignee username
```

Agents retrieve context with:

```bash
linear issue view AUT-55
```

---

## Issue Naming Convention

| Prefix | Layer | Example |
|--------|-------|---------|
| `DB-N` | Database / Schema / Migration | `DB-1: Create LaborCategory Prisma model` |
| `BE-N` | Backend service / API endpoint | `BE-3: Add bulk CSV import endpoint` |
| `FE-N` | Frontend component / page / hook | `FE-2: Labor Operations list page` |
| `QA-N` | Testing (e2e, unit, component) | `QA-1: E2E tests for LaborCategory CRUD` |

Issues are numbered per-project, not globally. Reuse `DB-1`, `BE-1` etc. across different projects.

---

## Issue Description Template

When writing `--description-file` content, use this structure:

```markdown
## Context

**Spec:** `docs/internal/02-Feature-Specs/<Module>/<feature>.md`
**ADR:** `docs/internal/01-ADR/<adr>.md` (if applicable)

## Acceptance Criteria

- [ ] Concrete, testable criterion
- [ ] Another testable criterion

## Technical Notes

Implementation guidance pulled from the Feature Spec's
DB/API/UX sections.

## Dependencies

- Blocked by: AUT-XX (if any)
```

---

## Label Strategy

| Layer | Labels | When to Use |
|-------|--------|-------------|
| **Stack** | `database`, `backend`, `frontend` | Always — indicates which codebase area |
| **Type** | `api`, `ui`, `schema`, `seed`, `policy` | When the issue targets a specific concern |
| **Quality** | `testing`, `e2e`, `unit`, `component` | For QA issues |
| **Contract** | `contract`, `types` | When OpenAPI/type regeneration is involved |

---

## Quick Reference: Common CLI Commands

```bash
# Auth
linear auth whoami

# Projects
linear project list
linear project view <slug>
linear project create -n "Name" -t AUT -l @me -s planned -j

# Milestones
linear milestone list --project <slug>
linear milestone create --project <slug> --name "Name" --target-date YYYY-MM-DD

# Issues
linear issue list --team AUT --sort manual --all-states -A --no-pager
linear issue list --project "Name" --sort manual --all-states -A --no-pager
linear issue create -t "Title" --project "Name" -l label --team AUT --no-interactive
linear issue view AUT-55
linear issue update AUT-55 --assignee username

# Labels
linear label list
```

---

## File Locations

| What | Where |
|------|-------|
| Feature Spec template | `docs/internal/templates/Feature Spec.md` |
| ADR template | `docs/internal/templates/ADR.md` |
| Temp issue descriptions | `docs/internal/.linear-drafts/` (gitignored) |
| This runbook | `docs/internal/05-Runbooks/linear-integration-workflow.md` |
