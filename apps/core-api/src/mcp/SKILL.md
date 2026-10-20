---
name: acp-mcp
description: Use the ACP MCP server safely; read the canonical tool catalog and behavior instructions before making MCP calls.
---

# ACP MCP skill

Read and follow [AGENTS.md](./AGENTS.md) before using the ACP MCP server. It is the canonical source for registered tools, policy behavior, errors, trace IDs, and safe usage recipes.

For MCP write tools, preview first with `dry_run: true`, inspect `policy_decision` and `would_change`, then call again without `dry_run` when policy allows execution or proposal.

Example read questions (wave 2 loaner / estimates / comms / check-in / staff):

- “Welche Leihwagen sind überfällig?” → `list_loaner_bookings` with `overdueOnly: true`
- “Welche KVAs von Kunde X sind offen?” → `list_estimates` with `customerId` and `status: SENT`

Example customer master-data questions:

- “Lege einen neuen Kunden an.” → `propose_customer_create` with the customer type, name, and contact data. The server checks the tenant for a duplicate e-mail, phone, UID, and name with postcode, and refuses an exact e-mail or UID hit with `DUPLICATE_CUSTOMER`. Then propose `propose_customer_update` for the customer it found.
- “Ändere die E-Mail-Adresse von Kunde X.” → `propose_customer_update` with the `customer_id`, the changed fields in `changes`, and a `reason`. Only the changed fields are stored, and a person approves the change.

Both tools are PROPOSE-only: they store a pending proposal and change nothing until a person applies it. Consent fields are not writable and are rejected by the schema.
