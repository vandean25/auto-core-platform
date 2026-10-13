-- AUT-356 phase 2: sender identity snapshot on the outbox row. Expand-only: two nullable columns with
-- no default. Filled at enqueue from the seller legal entity (display name and reply-to address), so a
-- later profile edit cannot change a message that is already queued (ADR-0025 section 6).
ALTER TABLE "notification_outbox" ADD COLUMN "sender_name" TEXT,
ADD COLUMN "reply_to_email" TEXT;
