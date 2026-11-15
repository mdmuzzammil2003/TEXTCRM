CREATE TABLE "stc_settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"customer_rate_aud" numeric(12, 2),
	"internal_rate_aud" numeric(12, 2),
	"admin_charges_aud" numeric(12, 2),
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stc_settings_single_row" CHECK ("stc_settings"."id")
);
--> statement-breakpoint
ALTER TABLE "stc_settings" ADD CONSTRAINT "stc_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- The rates and charges used to be typed on each project's STC claim. The global settings start
-- from the most recently saved value of each (none on a new database); the per-project values
-- stay in project_stc_claims untouched, no longer used or shown.
INSERT INTO "stc_settings" ("id", "customer_rate_aud", "internal_rate_aud", "admin_charges_aud")
SELECT true,
  (SELECT "customer_stc_rate_aud" FROM "project_stc_claims" WHERE "customer_stc_rate_aud" IS NOT NULL ORDER BY "updated_at" DESC LIMIT 1),
  (SELECT "internal_stc_rate_aud" FROM "project_stc_claims" WHERE "internal_stc_rate_aud" IS NOT NULL ORDER BY "updated_at" DESC LIMIT 1),
  (SELECT "admin_charges_aud" FROM "project_stc_claims" WHERE "admin_charges_aud" IS NOT NULL ORDER BY "updated_at" DESC LIMIT 1)
WHERE EXISTS (
  SELECT 1 FROM "project_stc_claims"
  WHERE "customer_stc_rate_aud" IS NOT NULL OR "internal_stc_rate_aud" IS NOT NULL OR "admin_charges_aud" IS NOT NULL
);
