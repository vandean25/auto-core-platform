---
name: acp-mcp
description: Use the ACP MCP server safely; read the canonical tool catalog and behavior instructions before making MCP calls.
---

# ACP MCP skill

Read and follow [AGENTS.md](./AGENTS.md) before using the ACP MCP server. It is the canonical source for registered tools, policy behavior, errors, trace IDs, and safe usage recipes.

For MCP write tools, preview first with `dry_run: true`, inspect `policy_decision` and `would_change`, then call again without `dry_run` when policy allows execution or proposal.
