# CLAUDE.md

Project instructions for Claude Code live in `agents.md` (imported below, the single source of truth).

Key rules: run only lint, typecheck/build, related unit tests and new/changed e2e specs locally, since full e2e suites run only in CI; the CI check `Code Health (Fallow)` is the source of truth for code health; work in ponytail mode (`.agents/skills/ponytail/SKILL.md`) and follow the i18n skill (`.agents/skills/acp-i18n/SKILL.md`) for user-facing text.

To read Linear issues and their comments (ticket text, QA comments, decisions), use the Linear MCP tools (`mcp__Linear__get_issue`, `mcp__Linear__list_comments`; load them with ToolSearch if they are deferred), not the CLI in `.agents/skills/linear` (it needs an API key that cloud sessions do not have).

In Claude Code cloud sessions GitHub allows REST only (no GraphQL): `gh pr create`/`gh pr view` fail, so use `gh api` REST routes, e.g. `gh api repos/vandean25/auto-core-platform/pulls/<n>` or `gh api -X POST repos/vandean25/auto-core-platform/pulls ...`.

@agents.md
