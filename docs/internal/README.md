# Auto Core Platform — Internal Documentation Vault

Welcome to the **Auto Core Platform** team documentation vault.  
Open this folder (`docs/internal`) as an [Obsidian](https://obsidian.md) vault, or browse the Markdown files in any editor.

## Vault Structure

```
docs/internal/
├── 00-Inbox/              ← Unsorted drafts & quick notes
├── 01-ADR/                ← Architecture Decision Records
├── 02-Feature-Specs/      ← Per-feature specifications
│   ├── Sales/
│   ├── Purchase/
│   ├── Workshop/
│   ├── Inventory/
│   ├── Finance/
│   ├── Brand/
│   ├── Vehicle/
│   ├── Labor/
│   └── Dashboard/
├── 03-Component-Specs/    ← Shared UI & backend component docs
├── 04-Database/           ← Schema docs, migration notes, ERDs
├── 05-Runbooks/           ← Operational playbooks & checklists
├── assets/                ← Images, diagrams, attachments
└── templates/             ← Obsidian note templates
```

## Conventions

| Rule | Detail |
|------|--------|
| **New features** | Draft a Feature Spec using the template *before* implementation begins. |
| **Architecture changes** | Record the decision in `01-ADR/` using the ADR template. |
| **Naming** | Use `YYYY-MM-DD-kebab-case-title.md` for ADRs. Feature specs use the feature name. |
| **Tags** | Prefix with module: `sales`, `purchase`, `workshop`, `inventory`, `finance`, `brand`. |
| **Links** | Prefer `[[wiki-links]]` for cross-references inside the vault. |

## Quick-Start

1. Install [Obsidian](https://obsidian.md) (free for local use).  
2. **Open folder as vault** → select `docs/internal`.  
3. Browse `01-ADR/` for past architectural decisions.  
4. Use **Ctrl+T** (Templates) to scaffold a new Feature Spec or ADR.
