-- Expand-only: ancillary workshop fees (loaner car, disposal, flat fees)
ALTER TYPE "WorkshopLineItemType" ADD VALUE IF NOT EXISTS 'FEE';
