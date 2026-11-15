-- The project's status and its installation status move together, whichever one is changed
-- (in the app, through the API or straight in the database):
--   project Completed <-> installation "Installation Completed" (or "Complete")
--   project Closed    <-> installation "Closed"
--   project Lost      <-> installation "Cancelled"
--   project Active    <-> any other installation status ("Unscheduled" when reopened)
-- A change made by one trigger doesn't bounce back (pg_trigger_depth guard).

CREATE FUNCTION "project_status_for_installation"(installation_status text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN installation_status IN ('Installation Completed', 'Complete') THEN 'Completed'
    WHEN installation_status = 'Closed' THEN 'Closed'
    WHEN installation_status = 'Cancelled' THEN 'Lost'
    ELSE 'Active'
  END
$$;
--> statement-breakpoint
CREATE FUNCTION "project_status_to_installation"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  current_status text;
  target text;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  SELECT "status" INTO current_status FROM "project_installation" WHERE "project_id" = NEW."id";
  IF "project_status_for_installation"(current_status) = NEW."status" THEN
    RETURN NEW;
  END IF;
  target := CASE NEW."status"
    WHEN 'Completed' THEN 'Installation Completed'
    WHEN 'Closed' THEN 'Closed'
    WHEN 'Lost' THEN 'Cancelled'
    ELSE 'Unscheduled'
  END;
  INSERT INTO "project_installation" ("project_id", "status")
  VALUES (NEW."id", target)
  ON CONFLICT ("project_id") DO UPDATE SET "status" = EXCLUDED."status", "updated_at" = now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "projects_status_sync"
AFTER UPDATE OF "status" ON "projects"
FOR EACH ROW WHEN (OLD."status" IS DISTINCT FROM NEW."status")
EXECUTE FUNCTION "project_status_to_installation"();
--> statement-breakpoint
CREATE FUNCTION "installation_status_to_project"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target text;
BEGIN
  IF pg_trigger_depth() > 1 OR NEW."status" IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
    RETURN NEW;
  END IF;
  target := "project_status_for_installation"(NEW."status");
  UPDATE "projects" SET
    "status" = target,
    "closed_at" = CASE WHEN target = 'Active' THEN NULL ELSE coalesce("closed_at", now()) END,
    "stage" = CASE
      WHEN target = 'Completed' THEN 'Completed'
      WHEN target = 'Active' AND "stage" = 'Completed' THEN 'DNSP Grid Inspection & Metering'
      ELSE "stage"
    END,
    "updated_at" = now()
  WHERE "id" = NEW."project_id" AND "status" <> target AND "deleted_at" IS NULL;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "project_installation_status_sync"
AFTER INSERT OR UPDATE OF "status" ON "project_installation"
FOR EACH ROW EXECUTE FUNCTION "installation_status_to_project"();
