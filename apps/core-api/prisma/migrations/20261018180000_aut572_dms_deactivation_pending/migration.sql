-- Expand-only: retryable remote deactivation after sale (AUT-572 review).
ALTER TYPE "VehicleListingDmsSyncState" ADD VALUE 'DEACTIVATION_PENDING';
