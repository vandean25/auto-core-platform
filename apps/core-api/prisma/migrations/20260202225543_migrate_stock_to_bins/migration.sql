-- 1. Identify Warehouses that have stock directly assigned to them
-- 2. Create a "General Bin" for each of these warehouses
INSERT INTO "storage_locations" (id, name, code, type, parent_id, "createdAt", "updatedAt")
SELECT 
    gen_random_uuid(), -- New ID
    'General Bin', -- Name
    "code" || '-GEN', -- Unique Code derived from Warehouse Code
    'bin', -- Type
    id, -- Parent ID (The Warehouse)
    NOW(),
    NOW()
FROM "storage_locations"
WHERE "type" = 'warehouse'
AND EXISTS (
    SELECT 1 FROM "inventory_stocks" WHERE "location_id" = "storage_locations".id
)
AND NOT EXISTS (
    -- Avoid creating duplicate General Bin if one already exists with this code logic
    SELECT 1 FROM "storage_locations" sl2 WHERE sl2.code = "storage_locations".code || '-GEN'
);

-- 3. Move Stock from Warehouse to its new General Bin
UPDATE "inventory_stocks"
SET "location_id" = (
    SELECT id 
    FROM "storage_locations" 
    WHERE "parent_id" = "inventory_stocks"."location_id" 
    AND "type" = 'bin' 
    AND "name" = 'General Bin'
    LIMIT 1
)
WHERE "location_id" IN (
    SELECT id FROM "storage_locations" WHERE "type" = 'warehouse'
)
AND EXISTS (
    SELECT id 
    FROM "storage_locations" 
    WHERE "parent_id" = "inventory_stocks"."location_id" 
    AND "type" = 'bin' 
    AND "name" = 'General Bin'
);

-- 4. Move Transactions (Optional but recommended for consistency)
UPDATE "inventory_transactions"
SET "location_id" = (
    SELECT id 
    FROM "storage_locations" 
    WHERE "parent_id" = "inventory_transactions"."location_id" 
    AND "type" = 'bin' 
    AND "name" = 'General Bin'
    LIMIT 1
)
WHERE "location_id" IN (
    SELECT id FROM "storage_locations" WHERE "type" = 'warehouse'
)
AND EXISTS (
    SELECT id 
    FROM "storage_locations" 
    WHERE "parent_id" = "inventory_transactions"."location_id" 
    AND "type" = 'bin' 
    AND "name" = 'General Bin'
);
