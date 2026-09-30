-- AlterTable
ALTER TABLE "document_brand_profiles" ADD COLUMN "draft_source_asset_id" TEXT;

-- AddForeignKey
ALTER TABLE "document_brand_profiles" ADD CONSTRAINT "document_brand_profiles_tenant_id_legal_entity_id_draft_sou_fkey" FOREIGN KEY ("tenant_id", "legal_entity_id", "draft_source_asset_id") REFERENCES "document_brand_assets"("tenant_id", "legal_entity_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
