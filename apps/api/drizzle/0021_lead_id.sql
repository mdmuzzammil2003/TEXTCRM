-- The sheet's Lead ID becomes the CRM's Lead ID: typed in on the form or read from a sheet, unique
-- across the CRM (it is also the Project ID once converted). Values are kept as they are.
ALTER TABLE "leads" RENAME COLUMN "sheet_lead_id" TO "lead_id";--> statement-breakpoint
DROP INDEX IF EXISTS "leads_sheet_source_lead_id_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "leads_sheet_lead_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "leads_lead_id_unique" ON "leads" USING btree ("lead_id") WHERE "leads"."lead_id" is not null;
