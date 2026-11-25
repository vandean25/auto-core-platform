---
name: acp-docs-check
description: Use when changing user-visible ACP behavior or preparing a PR that changes the UI, translations, or public API contract.
---

# ACP docs check

Update the matching public docs in `docs-site/` (de-AT) and `docs-site/en/` using the [Mintlify docs skill](../mintlify-docs/SKILL.md). The ACP Doku bot owns `docs-site/` content and can help with updates.

List the updated pages on the PR body's `Docs:` line. If the change needs no public docs update, write `Docs: n/a – <reason>` with a specific reason.
