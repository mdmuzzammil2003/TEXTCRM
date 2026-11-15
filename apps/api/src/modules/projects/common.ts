import { TRPCError } from '@trpc/server';
import { eq, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client.ts';
import { projects } from '../../db/schema/index.ts';
import { diff, recordAudit, type Actor } from '../audit.ts';

export type Ctx = { user: { id: string }; meta: Actor['meta'] };

/**
 * The Project ID people see: the Lead ID of the lead it was converted from (locked from then on).
 * `projects.project_number` (MMS-YYYY-NNNN) stays as an internal number and is never shown.
 */
// Written out with table names: drizzle leaves columns unqualified in one-table selects, and
// "lead_id" would then mean the subquery's leads.lead_id instead of projects.lead_id.
export const projectRef = sql<
  string | null
>`(select pl.lead_id from leads pl where pl.id = "projects"."lead_id")`;

export const notFound = () =>
  new TRPCError({ code: 'NOT_FOUND', message: 'This project does not exist.' });

export const actorOf = (ctx: Ctx): Actor => ({ userId: ctx.user.id, meta: ctx.meta });

export async function editableProject(tx: Db | Tx, id: string) {
  const [project] = await tx.select().from(projects).where(eq(projects.id, id));
  if (!project || project.deletedAt) throw notFound();
  return project;
}

/**
 * Saves one 1:1 section row if anything changed: `upsert` writes it, then the project is marked
 * as updated by this user and the changed fields are audit-logged under `action`.
 * Returns the changes, or null when nothing changed.
 */
export async function saveSection(
  tx: Tx,
  ctx: Ctx,
  projectId: string,
  action: string,
  existing: Record<string, unknown> | undefined,
  values: Record<string, unknown>,
  upsert: () => Promise<unknown>,
) {
  const changes = diff(existing ?? {}, values);
  if (!changes) return null;
  await upsert();
  await tx.update(projects).set({ updatedByUserId: ctx.user.id }).where(eq(projects.id, projectId));
  await recordAudit(tx, actorOf(ctx), {
    action,
    entityType: 'project',
    entityId: projectId,
    ...changes,
  });
  return changes;
}
