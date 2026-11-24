# First-run Sign-in Surface Design

## Goal

Give unauthenticated visitors a useful first-run surface at `/` while keeping sign-in invite-only and preserving the existing authentication flow.

## Approved behavior

- Keep sign-in as the primary action; do not add public signup.
- Show a product explainer beside the sign-in card at widths of 768px and above, and stack it above the card on smaller screens.
- Use the approved copy: `Auto Core`, `ACP keeps stock, jobs, and invoices in one workshop ledger.`, and the bullets `Parts on the shelf`, `Jobs on the board`, and `Invoices with a paper trail`.
- Describe the card as `Sign in with the email your workshop invited.`
- Add Google sign-in, email/password sign-in, forgot-password, and a documentation link.
- Show the demo account hint only when `window.location.hostname` is `auto-core-platform-vande.web.app`; never display passwords.
- Replace configuration diagnostics with `Sign-in is not configured for this deployment.`

## Boundaries and error handling

`AuthProvider` exposes `sendPasswordResetEmail(email)` and rejects blank email input. `LoginPage` validates the email, sends the reset request, and displays the approved success or error toast. Firebase and environment-variable details remain implementation-only.

## Testing

Component tests cover the approved copy, responsive-surface content, demo-host gating, validation, success/error reset toasts, and existing credential behavior. Existing auth-provider tests cover the new reset action's Firebase delegation and blank-email guard.

## Impact analysis

This is a frontend auth-surface and documentation change. It adds no database entities, migrations, API routes, generated contracts, status transitions, realtime events, inventory writes, finance behavior, or deletion-policy entries.
