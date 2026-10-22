-- Expand-only: pg_trgm + GIN trigram indexes for global search S1 (AUT-661)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "catalog_items_name_trgm_idx" ON "catalog_items" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "catalog_items_sku_trgm_idx" ON "catalog_items" USING GIN ("sku" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "credit_notes_credit_number_trgm_idx" ON "credit_notes" USING GIN ("credit_number" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "customers_first_name_trgm_idx" ON "customers" USING GIN ("first_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "customers_last_name_trgm_idx" ON "customers" USING GIN ("last_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "customers_company_name_trgm_idx" ON "customers" USING GIN ("company_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "customers_email_trgm_idx" ON "customers" USING GIN ("email" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "customers_phone_trgm_idx" ON "customers" USING GIN ("phone" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "employees_name_trgm_idx" ON "employees" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "invoices_invoice_number_trgm_idx" ON "invoices" USING GIN ("invoice_number" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "legal_entities_name_trgm_idx" ON "legal_entities" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "purchase_invoices_invoice_number_trgm_idx" ON "purchase_invoices" USING GIN ("invoice_number" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "purchase_invoices_vendor_invoice_number_trgm_idx" ON "purchase_invoices" USING GIN ("vendor_invoice_number" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "purchase_orders_order_number_trgm_idx" ON "purchase_orders" USING GIN ("order_number" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "sales_orders_order_number_trgm_idx" ON "sales_orders" USING GIN ("order_number" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "sites_name_trgm_idx" ON "sites" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "vehicle_sales_sale_number_trgm_idx" ON "vehicle_sales" USING GIN ("sale_number" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "vehicles_plate_trgm_idx" ON "vehicles" USING GIN ("plate" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "vehicles_vin_trgm_idx" ON "vehicles" USING GIN ("vin" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "vendors_name_trgm_idx" ON "vendors" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "workshop_estimates_estimate_number_trgm_idx" ON "workshop_estimates" USING GIN ("estimate_number" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "workshop_orders_order_number_trgm_idx" ON "workshop_orders" USING GIN ("order_number" gin_trgm_ops);
