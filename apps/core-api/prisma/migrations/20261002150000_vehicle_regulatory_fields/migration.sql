-- Expand-only: nullable regulatory columns on vehicles (AUT-375)
ALTER TABLE "vehicles"
ADD COLUMN "first_registration_date" DATE,
ADD COLUMN "co2_wltp_g_km" INTEGER,
ADD COLUMN "co2_nedc_g_km" INTEGER,
ADD COLUMN "typenschein_no" TEXT,
ADD COLUMN "nova_class" TEXT,
ADD COLUMN "emission_class" TEXT;
