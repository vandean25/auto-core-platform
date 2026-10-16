-- AUT-357: ready-for-pickup transactional email on WORKSHOP_ORDER_READY (expand-only enum).
ALTER TYPE "NotificationEventType" ADD VALUE 'WORKSHOP_ORDER_READY';
