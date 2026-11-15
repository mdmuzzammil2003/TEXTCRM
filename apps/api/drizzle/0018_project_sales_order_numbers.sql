ALTER TABLE "project_warehouse" ADD COLUMN "sales_order_numbers" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
-- Carry each job's one sales order number over (split on spaces, commas or semicolons, the same
-- separators the tag input uses).
UPDATE "project_warehouse"
SET "sales_order_numbers" = ARRAY(
  SELECT part
  FROM unnest(regexp_split_to_array(trim("sales_order_number"), '[\s,;]+')) WITH ORDINALITY AS t(part, n)
  WHERE part <> ''
  GROUP BY part
  ORDER BY min(n)
)
WHERE "sales_order_number" IS NOT NULL AND trim("sales_order_number") <> '';
