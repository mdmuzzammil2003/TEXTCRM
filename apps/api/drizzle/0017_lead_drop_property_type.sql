ALTER TABLE "lead_system_requirements" DROP COLUMN "property_type";--> statement-breakpoint
-- "Property Type" is no longer an importable field: drop it from saved column mappings so live
-- sheet syncs and unfinished imports keep passing the mapping check.
UPDATE "sheet_sync_sources" SET "mapping" = "mapping" - 'propertyType' WHERE "mapping" ? 'propertyType';--> statement-breakpoint
UPDATE "import_jobs" SET "mapping" = "mapping" - 'propertyType' WHERE "mapping" ? 'propertyType';
