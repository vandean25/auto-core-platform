-- Adds the in_transit value to LocationType so the multi-location migration
-- can populate system StockTransfer transit locations. This MUST be a separate
-- migration because PostgreSQL cannot use a newly-added enum value in the same
-- transaction that added it (error 55P04).
ALTER TYPE "LocationType" ADD VALUE 'in_transit';