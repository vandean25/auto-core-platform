ALTER TABLE "vehicle_sales"
    ADD COLUMN "contract_concluded_at" DATE,
    ADD COLUMN "handed_over_at" DATE,
    ADD COLUMN "buyer_is_consumer" BOOLEAN,
    ADD COLUMN "gewaehrleistung_shortened_negotiated" BOOLEAN,
    ADD COLUMN "gewaehrleistung_note" TEXT,
    ADD COLUMN "gewaehrleistung_ends_on" DATE,
    ADD COLUMN "presumption_ends_on" DATE,
    ADD COLUMN "gewaehrleistung_rule_version" TEXT;
