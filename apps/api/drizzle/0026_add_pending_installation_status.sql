-- "Pending" joins the installation statuses, first in the list. It means the project is Active
-- (the status link of 0023 maps every status but the finished ones to Active).
-- Idempotent: skipped when the list doesn't exist yet (a new database: the seed adds it) or
-- already has the value.
INSERT INTO "options" ("list_id", "value", "label", "sort_order")
SELECT "id", 'Pending', 'Pending', 5 FROM "option_lists" WHERE "key" = 'installationStatuses'
ON CONFLICT ("list_id", "value") DO NOTHING;
