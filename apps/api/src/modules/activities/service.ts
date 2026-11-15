import { and, eq, isNull } from 'drizzle-orm';
import { ACTIVITY_ENTITY_FEATURE, hasPermission, type ActivityEntityType } from '@mms/shared';
import type { AuthUser } from '../../auth/types.ts';
import type { Db, Tx } from '../../db/client.ts';
import { activities, projects } from '../../db/schema/index.ts';

export { assertEntityExists } from '../entities.ts';

/**
 * The lead a project was converted from, when the user may see leads. A project page shows that
 * lead's activity, messages and history next to its own, so nothing logged before the sale is lost.
 */
export async function linkedLeadId(
  db: Db | Tx,
  user: AuthUser,
  entityType: ActivityEntityType,
  entityId: string,
): Promise<string | null> {
  if (entityType !== 'project') return null;
  if (!hasPermission(user.permissions, ACTIVITY_ENTITY_FEATURE.lead, 'view')) return null;
  const [row] = await db
    .select({ leadId: projects.leadId })
    .from(projects)
    .where(eq(projects.id, entityId));
  return row?.leadId ?? null;
}

/**
 * A timeline entry written by the CRM itself, e.g. "Status: New → Contacted". Runs in the
 * caller's transaction so it's recorded exactly when the change is.
 */
export async function logSystemActivity(
  db: Db | Tx,
  entry: {
    entityType: ActivityEntityType;
    entityId: string;
    authorUserId: string | null;
    subject: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(activities).values({
    entityType: entry.entityType,
    entityId: entry.entityId,
    type: 'system',
    subject: entry.subject,
    metadata: entry.metadata ?? null,
    authorUserId: entry.authorUserId,
  });
}

/** Open tasks on a record — e.g. shown on the lead header. */
export function openTasksWhere(entityType: ActivityEntityType, entityId: string) {
  return and(
    eq(activities.entityType, entityType),
    eq(activities.entityId, entityId),
    eq(activities.type, 'task'),
    isNull(activities.completedAt),
    isNull(activities.deletedAt),
  );
}
