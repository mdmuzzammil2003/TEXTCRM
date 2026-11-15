-- A Closed or Lost project (and its sections) can only be changed by an Admin. The API checks
-- this first and, for an Admin, sets the transaction-local setting mms.admin = 'on'; these
-- triggers refuse any other change. Changes made by another trigger (the status link of 0023,
-- cascades from a project deletion) are let through.

CREATE FUNCTION "closed_project_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  project uuid;
  project_status text;
BEGIN
  IF pg_trigger_depth() > 1 OR coalesce(current_setting('mms.admin', true), '') = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_TABLE_NAME = 'projects' THEN
    project_status := OLD."status";
  ELSE
    project := CASE WHEN TG_OP = 'DELETE' THEN OLD."project_id" ELSE NEW."project_id" END;
    SELECT "status" INTO project_status FROM "projects" WHERE "id" = project;
  END IF;
  IF project_status IN ('Closed', 'Lost') THEN
    RAISE EXCEPTION 'Only Admin can edit closed or lost projects.' USING ERRCODE = 'MM403';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "projects_closed_guard" BEFORE UPDATE ON "projects"
FOR EACH ROW EXECUTE FUNCTION "closed_project_guard"();
--> statement-breakpoint
CREATE TRIGGER "project_pricing_closed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "project_pricing"
FOR EACH ROW EXECUTE FUNCTION "closed_project_guard"();
--> statement-breakpoint
CREATE TRIGGER "project_system_design_closed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "project_system_design"
FOR EACH ROW EXECUTE FUNCTION "closed_project_guard"();
--> statement-breakpoint
CREATE TRIGGER "project_system_inverters_closed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "project_system_inverters"
FOR EACH ROW EXECUTE FUNCTION "closed_project_guard"();
--> statement-breakpoint
CREATE TRIGGER "project_eb_verification_closed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "project_eb_verification"
FOR EACH ROW EXECUTE FUNCTION "closed_project_guard"();
--> statement-breakpoint
CREATE TRIGGER "project_grid_applications_closed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "project_grid_applications"
FOR EACH ROW EXECUTE FUNCTION "closed_project_guard"();
--> statement-breakpoint
CREATE TRIGGER "project_finance_closed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "project_finance"
FOR EACH ROW EXECUTE FUNCTION "closed_project_guard"();
--> statement-breakpoint
CREATE TRIGGER "project_warehouse_closed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "project_warehouse"
FOR EACH ROW EXECUTE FUNCTION "closed_project_guard"();
--> statement-breakpoint
CREATE TRIGGER "project_installation_closed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "project_installation"
FOR EACH ROW EXECUTE FUNCTION "closed_project_guard"();
--> statement-breakpoint
CREATE TRIGGER "project_stc_claims_closed_guard" BEFORE INSERT OR UPDATE OR DELETE ON "project_stc_claims"
FOR EACH ROW EXECUTE FUNCTION "closed_project_guard"();
