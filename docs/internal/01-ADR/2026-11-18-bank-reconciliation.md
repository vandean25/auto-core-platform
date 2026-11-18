---
title: "ADR-0040: Bank Reconciliation for ACP Invoices"
date: "2026-11-18"
status: accepted
deciders: "Product Owner (Dejan Dosenovic)"
linear-issue: "https://linear.app/auto-core-platform/issue/AUT-1001"
tags: [adr, finance, invoices, bank-reconciliation]
---

# ADR-0040: Bank Reconciliation for ACP Invoices

## Status

**Accepted (2026-11-18).** Dejan Dosenovic confirmed the V1 scope for [AUT-1001](https://linear.app/auto-core-platform/issue/AUT-1001).

> yes, this captures the v1 scope. write the docs-only ADR for AUT-1001.

The release gates below still apply. This decision establishes the contract for BR-1 through BR-3.

## Context

Workshops issue invoices in ACP and receive transfers in their bank accounts. Staff need to see which invoices a transfer paid and what balance remains. Accounting owns the books, refunds, and migrated open items. [ADR-0023](2026-09-20-legal-invoicing-and-accounting-export.md) governs the existing invoice and credit-note export. [ADR-0031](2026-10-19-incadea-migration-hard-cutover.md) governs legacy balances.

## Decision

### Access and ownership

Dejan confirmed the Finance Settings decision on 2026-11-18.

> yes, keep bank reconciliation off by default, with an audited switch in Finance Settings that only tenant owners and admin can change.

He then added switch access for accountants with tenant-wide reconciliation access.

> yes, only accountants with tenant-wide reconciliation access can change the switch. accountants assigned to specific legal entities can reconcile only for those entities.

- `FinanceSettings.bank_reconciliation_enabled` defaults to `false`. Owners and Admins can change it. Accountants need both tenant-wide reconciliation access and an explicit grant to change the switch. Record the actor, time, and old and new values. The session exposes effective access, and the API enforces it on every request. With the flag off, reconciliation endpoints return 404 and the page, navigation, and Cmd+K actions are unavailable. MCP access to the switch is read-only.
- Owners, Admins, and accountants with reconciliation access can import, review, confirm, undo, dismiss, restore, handle follow-up, and export within their authorized scope. An accountant assigned to specific legal entities can act only for those entities. The same scope applies to bank account setup, search, export history, and re-downloads. Derive scope from authenticated membership and grants. Verify tenant and legal entity ownership at lookup and again when committing changes.
- The current tenant roles have no `ACCOUNTANT` role. BR-1 must provide a reviewed permission model for accountant access before enabling it. Define separate permissions for changing the tenant switch and operating reconciliation, with an explicit tenant-wide or legal-entity scope for operational access. Follow the operation-based design in [ADR-0034](2026-11-02-custom-tenant-roles.md), which is currently proposed. Accountant authorization requires an active membership and an enforceable grant. A legal-entity grant alone cannot authorize a tenant-wide settings write, and the settings grant applies only to this switch.
- Register each receiving bank account under one legal entity in the tenant. Derive statement ownership from the normalized receiving IBAN. Block unknown accounts and files that would resolve to more than one legal entity. A transfer can settle only invoices issued by the legal entity that received it.

### Statement import

- Support the single `camt.053` XML version the pilot bank exports. Verify the exact namespace and bank transaction identifiers before BR-1 implements the parser. Use a synthetic fixture that represents that version and the bank's statement structure.
- Import booked credits into the review queue. Debit entries do not become allocatable transfers. Retain the booking date, credit amount and currency, bank transaction reference, and necessary remitter and reference data. Flag non-EUR credits for accounting review. Only EUR credits can be allocated to EUR invoices in V1.
- Deduplicate exact file re-uploads and overlapping statements. Keep a file fingerprint and enforce transaction identity using the stable bank transaction reference scoped to the tenant and receiving account. If the parser cannot establish stable identity for a credit, reject the import with an actionable validation error. Importing and viewing suggestions have no effect on invoices or payments.
- Discard the uploaded XML after processing. Retain normalized transaction data, an import summary, and the file fingerprint. Store only a keyed remitter IBAN fingerprint and its last four characters. The full receiving IBAN remains in bank account setup. Keep remitter names and fingerprint matching inside ACP.

### Suggestions and Decision Adapter

- Candidates are issued ACP invoices with positive outstanding balances in the transfer's tenant and legal entity, in EUR, and visible to the current user. Legacy open items, drafts, and invoices with no outstanding balance are ineligible. Searching and manually entering one or several allocation amounts works with or without suggestions.
- Rules rank complete proposed splits using verifiable evidence. Give explicit invoice references the strongest weight, give exact coverage of the outstanding balance and a previously confirmed remitter fingerprint supporting weight, and give name similarity weak weight. A prior IBAN match applies only to the same customer and legal entity and comes from an allocation that is still confirmed. Show the evidence for each split, including the invoice references found, amounts applied, balances remaining, and any unallocated transfer amount. Amount alone is weak even if it matches exactly one invoice. Name alone leaves the allocation unresolved.
- Treat one explicit, unambiguous reference with no conflicting evidence as clear. Apply up to that invoice's outstanding balance in the suggestion, including for a partial payment or an overpayment. Multiple explicit references are clear when they identify a unique split that covers the referenced outstanding balances and there is no conflicting evidence. Automatically call the model when the rules find no clear split or multiple plausible splits.
- Extend the existing [Decision Adapter](../02-Feature-Specs/Platform/decision-adapter.md) with a bank reconciliation use case and structured output for proposing and ranking complete splits. Reuse its provider boundary, timeouts, tracing, fallback, and evaluation harness. The current single-choice contract is suitable for the existing use cases. Bank reconciliation needs structured invoice references and amounts for each ranked split.
- Send only transfer amount and currency, redacted remittance text, and eligible invoice references and outstanding balances. Redact names, contact details, IBANs, and unrelated personal information before the call while preserving the invoice references needed for matching. Treat remittance text as untrusted input. Validate the model output against the eligible invoices and current balances and derive displayed evidence inside ACP. Use only validated suggestions. Rule-based suggestions and manual entry remain available when the provider is disabled, unavailable, times out, or returns invalid output.

### Confirmation, balance, and undo

- Support one transfer covering one invoice, several transfers against the same invoice, and one transfer split across several invoices. Staff review the invoice and amount on each line and explicitly confirm the split. Commit the split atomically. Each confirmed line creates a `BANK_TRANSFER` payment linked to the source transaction. Use `SETTLED` for a confirmed bank allocation. `SETTLED_EXTERNAL` retains its meaning for cash-register settlement with an external receipt. Once RKSV review clears the bank-transfer path, it generates no fiscal receipt.
- `SETTLED` records completion of a payment. Classify a payment as RKSV-signed only when it is a fiscal cash/card payment with a linked receipt whose state is `SIGNED`. Use the payment method and receipt evidence when selecting fiscal payments for display, reports, exports, and reversals. A settled bank-transfer allocation has no fiscal receipt, and undo uses the bank allocation inverse. BR-2 must verify that the bank payment appears in invoice payment history and is excluded from RKSV-signed results.
- Calculate outstanding balance from the issued invoice gross amount, less finalized credit notes and active settled payments, floored at zero. Keep the signed difference for follow-up. A partial allocation leaves the invoice `ISSUED`. An allocation moves it to `PAID` when the balance reaches zero. Prevent over-collection through competing settlement paths and recheck pending fiscal settlement before confirming. [AUT-916](https://linear.app/auto-core-platform/issue/AUT-916) guards the existing cash/card path against collecting gross after a finalized credit note. The bank path uses the net outstanding balance.
- Recheck versions, permissions, ownership, and all amounts in the same transaction as confirmation. A split can consume at most the transfer's unallocated amount, and each line can consume at most its invoice's outstanding balance. Stale or conflicting requests change nothing. Retrying a confirmed request cannot create duplicate allocations. Record the confirming user and time, whether the split came from rules, the model, or manual entry, and the verified evidence shown at confirmation.
- Undo one allocation through a version-checked server inverse per [ADR-0036 R3](2026-11-02-frontend-interaction-rules.md#r3-undo-only-a-committed-safely-reversible-operation). Keep the original payment and reversal history. Recalculate the invoice balance and release the reversed amount without changing the other allocations. Reopen a paid invoice when it has a positive outstanding balance again. Staff handle a returned transfer by recording the return reason and manually reversing its affected allocations. Once marked returned, the transfer is ineligible for further allocations. Import, navigation, and suggestion generation never book or reverse a payment.
- Leave overpayments unallocated on the bank transaction. If a finalized credit note later reduces the amount owed below what was already applied, preserve the original allocation and flag the excess. Keep unresolved items visible in the accounting follow-up filter after export. Staff can mark an item handled in accounting with a required note and an audit entry. That action changes follow-up status only. Staff can also dismiss a credit unrelated to invoices with a reason and restore it, with both actions recorded.

### Accounting handoff and retention

- Provide a separate incremental reconciliation CSV and immutable export history per legal entity. Each newly generated batch contains allocations and reversals since the previous batch for that entity. Record batch membership and mark entries exported atomically so retries and concurrent exports cannot omit or duplicate entries. Include stable batch and allocation identifiers, the bank transaction reference, invoice number, amount and currency, and the related transfer's remaining unallocated amount. Reversals identify the originally exported allocation and carry the amount reversed. An allocation undone before its first export is omitted with its reversal. Re-download returns the exact previous batch with its original identifier and bytes. Record the actor and export time.
- Keep the existing invoice and credit-note export defined by [ADR-0023](2026-09-20-legal-invoicing-and-accounting-export.md) unchanged. The reconciliation CSV communicates what staff confirmed and reversed. Accounting handles posting, refunds, balances outside the eligible ACP invoice set, and the legacy open items owned under ADR-0031.
- Retain confirmed allocations, reversals, and exported batches under the approved accounting retention policy. Use shorter retention for remitter fingerprints and names used for matching. Limit the confirmation audit to the confirmed allocation and verified evidence. Agree the exact periods with accounting and privacy reviewers before launch.

## Release gates and follow-through

1. The ACP Legal Researcher must clear the proposed no-fiscal-receipt treatment under RKSV before enabling bank-transfer settlement. Confirm the pilot bank's exact XML version and transaction reference behavior with a synthetic fixture before shipping the importer.
2. Require a bank-specific evaluation on synthetic statements before model use with real data. Cover clear and ambiguous references, partial and multi-invoice splits, wrong-currency and ineligible invoices, and invalid output. Compare validated suggestions against the rules baseline. Use only an approved provider whose terms prohibit training on submitted data and whose retention meets ACP's requirements. The existing Jev evaluation and [provider review](https://linear.app/auto-core-platform/issue/AUT-395) do not by themselves approve this use case. Keep rules and manual allocation usable while model access is gated.
3. [BR-1](https://linear.app/auto-core-platform/issue/AUT-1002) implements account ownership, permissions, the tenant switch, and import. [BR-2](https://linear.app/auto-core-platform/issue/AUT-1003) implements suggestions, settlement, undo, follow-up, and reconciliation export. [BR-3](https://linear.app/auto-core-platform/issue/AUT-1004) implements the review and accounting workflows, including keyboard confirmation for the reviewed split. This ADR supersedes the initial owner-only switch and single-invoice assumptions in those tickets.

The implementation must prove tenant and legal-entity isolation, duplicate-import protection, atomic allocation and undo, and export replay. A human confirmation is required for every allocation. Use synthetic fixtures and refer to the pilot deployment as the pilot customer.
