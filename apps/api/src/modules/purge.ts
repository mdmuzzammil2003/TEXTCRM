import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Tx } from '../db/client.ts';
import {
  activities,
  emailDrafts,
  emailMessages,
  files,
  leads,
  projects,
  smsMessages,
} from '../db/schema/index.ts';
import type { Storage } from '../storage/storage.ts';

// Permanent deletion of leads and projects, shared by the Admin "Delete permanently" action and
// the one-off clean-up script. Timeline entries, files and email drafts belong to the record and
// go with it; they're linked by entity_type + entity_id (no foreign key), so they're deleted here
// explicitly. The customers' SMS and emails stay on the contact, unlinked from the record.
// Lead pricing/system rows and project sections go by ON DELETE CASCADE. Call inside a
// transaction; remove the returned storage keys after it commits.

/** A table whose rows belong to a lead or project through entity_type + entity_id. */
type Linkable = { entityType: AnyPgColumn; entityId: AnyPgColumn };

/** Rows of `table` that belong to one of these projects or leads (none when both are empty). */
export function linkedTo(table: Linkable, projectIds: string[], leadIds: string[]): SQL {
  return (
    or(
      projectIds.length
        ? and(eq(table.entityType, 'project'), inArray(table.entityId, projectIds))
        : undefined,
      leadIds.length
        ? and(eq(table.entityType, 'lead'), inArray(table.entityId, leadIds))
        : undefined,
    ) ?? sql`false`
  );
}

/** Deletes the records and what belongs to them. Returns the stored files' keys to remove. */
export async function purgeRecords(
  tx: Tx,
  { projectIds, leadIds }: { projectIds: string[]; leadIds: string[] },
): Promise<string[]> {
  const on = (table: Linkable) => linkedTo(table, projectIds, leadIds);
  const doomedFiles = await tx
    .select({ storageKey: files.storageKey, thumbnailKey: files.thumbnailKey })
    .from(files)
    .where(on(files));
  await tx.delete(activities).where(on(activities));
  await tx.delete(files).where(on(files));
  await tx.delete(emailDrafts).where(on(emailDrafts));
  await tx.update(smsMessages).set({ entityType: null, entityId: null }).where(on(smsMessages));
  await tx.update(emailMessages).set({ entityType: null, entityId: null }).where(on(emailMessages));
  // Tickets keep their customer and lose the project link (ON DELETE SET NULL).
  if (projectIds.length) await tx.delete(projects).where(inArray(projects.id, projectIds));
  if (leadIds.length) await tx.delete(leads).where(inArray(leads.id, leadIds));
  return doomedFiles.flatMap((f) =>
    f.thumbnailKey ? [f.storageKey, f.thumbnailKey] : [f.storageKey],
  );
}

/** Removes stored file bytes after the deletion committed. Returns the keys that couldn't go. */
export async function removeStoredFiles(
  storage: Storage | null,
  keys: string[],
): Promise<string[]> {
  if (keys.length === 0) return [];
  if (!storage) return keys;
  try {
    await storage.remove(keys);
    return [];
  } catch {
    return keys;
  }
}
