ALTER TABLE "email_attachments" DROP CONSTRAINT "email_attachments_uploaded_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "email_attachments" ALTER COLUMN "uploaded_by_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "actor_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "author_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "email_attachments" ADD CONSTRAINT "email_attachments_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;